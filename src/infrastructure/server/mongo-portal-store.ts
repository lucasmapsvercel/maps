import { createHash, randomUUID } from "node:crypto";
import type { Db, MongoClient, WithId } from "mongodb";
import { PortalService } from "../../application/portal-service";
import { PortalError } from "../../application/portal-error";
import type { PortalSnapshot } from "../../application/portal-connection";
import { createEmptyState } from "../../domain/empty-state";
import { isViewCommand, type PortalCommand } from "../../domain/portal-command";
import { validateState } from "../../domain/portal-state";
import { ValidationError } from "../../domain/validation-error";
import type { PortalState } from "../../domain/types";
import type { Actor } from "./auth";

const viewKeys = ["page", "mobileView", "activeSearchId", "openTabs", "searchFilter", "visibility", "favoriteOnly"] as const;
type View = Pick<PortalState, typeof viewKeys[number]>;
type SharedState = Omit<PortalState, keyof View>;

interface WorkspaceDocument {
  _id: string;
  version: number;
  data: SharedState;
  updatedAt: Date;
}
interface ViewDocument {
  _id: string;
  workspaceId: string;
  userId: string;
  data: View;
}

function split(state: PortalState) {
  const { page, mobileView, activeSearchId, openTabs, searchFilter, visibility, favoriteOnly, ...data } = state;
  return { data, view: { page, mobileView, activeSearchId, openTabs, searchFilter, visibility, favoriteOnly } };
}

function snapshot(workspace: WithId<WorkspaceDocument>, view: View | undefined): PortalSnapshot {
  const defaults = split(createEmptyState()).view;
  return { version: workspace.version, state: validateState({ ...defaults, ...view, ...workspace.data }) };
}

export class MongoPortalStore {
  constructor(private readonly client: MongoClient, private readonly db: Db) {}

  async load(actor: Actor): Promise<PortalSnapshot> {
    const workspaces = this.db.collection<WorkspaceDocument>("portalWorkspaces");
    const initial = split(createEmptyState());
    await workspaces.updateOne({ _id: actor.workspaceId }, {
      $setOnInsert: { version: 0, data: initial.data, updatedAt: new Date() }
    }, { upsert: true });
    await this.db.collection("memberships").updateOne({ workspaceId: actor.workspaceId, userId: actor.userId }, {
      $setOnInsert: { role: "member", createdAt: new Date() }
    }, { upsert: true });
    const [workspace, view] = await Promise.all([
      workspaces.findOne({ _id: actor.workspaceId }),
      this.db.collection<ViewDocument>("portalViews").findOne({ workspaceId: actor.workspaceId, userId: actor.userId })
    ]);
    if (!workspace) throw new Error("Workspace não inicializado.");
    return snapshot(workspace, view?.data);
  }

  async execute(actor: Actor, command: PortalCommand, version: number, commandId: string = randomUUID()): Promise<PortalSnapshot> {
    const session = this.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const workspaces = this.db.collection<WorkspaceDocument>("portalWorkspaces");
        const views = this.db.collection<ViewDocument>("portalViews");
        const workspace = await workspaces.findOne({ _id: actor.workspaceId }, { session });
        if (!workspace) throw new PortalError(404, "WORKSPACE_NOT_FOUND", "Workspace não encontrado.");
        const view = await views.findOne({ workspaceId: actor.workspaceId, userId: actor.userId }, { session });
        const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
        const receipts = this.db.collection("commandReceipts");
        const receipt = await receipts.findOne({ workspaceId: actor.workspaceId, userId: actor.userId, commandId }, { session });
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new PortalError(409, "IDEMPOTENCY_CONFLICT", "Identificador de operação já usado com outro conteúdo.");
          return snapshot(workspace, view?.data);
        }
        if (workspace.version !== version) {
          throw new PortalError(409, "VERSION_CONFLICT", "Os dados foram alterados em outra aba ou sessão. Recarregue o portal antes de tentar novamente.");
        }
        const current = snapshot(workspace, view?.data);
        const service = new PortalService({ state: current.state, createId: randomUUID });
        try {
          service.execute(command);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          throw new PortalError(422, "INVALID_OPERATION", error.message);
        }
        if (command.type === "addComment") {
          const comment = service.state.comments[command.id].at(-1);
          if (comment) {
            comment.authorId = actor.userId;
            comment.authorName = actor.name;
          }
        }
        const next = split(service.state);
        if (Buffer.byteLength(JSON.stringify(next.data)) > 8 * 1024 * 1024) {
          throw new PortalError(413, "WORKSPACE_LIMIT", "O workspace atingiu o limite desta versão. Exporte os dados e solicite ampliação.");
        }
        const updated = await workspaces.updateOne({ _id: actor.workspaceId, version }, {
          $set: { data: next.data, updatedAt: new Date() }, $inc: { version: 1 }
        }, { session });
        if (updated.modifiedCount !== 1) throw new PortalError(409, "VERSION_CONFLICT", "Alteração concorrente. Recarregue o portal.");
        await views.updateOne({ workspaceId: actor.workspaceId, userId: actor.userId }, {
          $set: { data: next.view },
          $setOnInsert: { _id: randomUUID(), workspaceId: actor.workspaceId, userId: actor.userId }
        }, { upsert: true, session });
        await receipts.insertOne({
          workspaceId: actor.workspaceId, userId: actor.userId, commandId, fingerprint,
          expiresAt: new Date(Date.now() + 7 * 86400_000)
        }, { session });
        if (!isViewCommand(command)) {
          await this.db.collection("auditEvents").insertOne({
            workspaceId: actor.workspaceId, actorId: actor.userId,
            action: command.type, entityId: command.type === "addSearch" ? service.state.searches[0].id : "id" in command ? command.id : null,
            version: version + 1, createdAt: new Date()
          }, { session });
        }
        return { version: version + 1, state: service.state };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      if (!result) throw new Error("Transação não concluída.");
      return result;
    } finally {
      await session.endSession();
    }
  }
}
