import { createHash } from "node:crypto";
import type { MongoClient, Db } from "mongodb";
import { PortalError } from "../../application/portal-error";
import type { Actor } from "./auth";
import type { GoogleSearchLog } from "../../domain/google-search-log";

export type GoogleSearchRequest = {
  _id: string;
  createdAt: Date;
  workspaceId: string;
  userId: string;
} & Partial<Omit<GoogleSearchLog, "id" | "createdAt">>;

type LogContext = Pick<GoogleSearchLog, "actorName" | "searchId" | "term" | "city" | "source" | "continuation">;

interface Budget {
  _id: string;
  count: number;
}

export function googleBudgetPeriod(scope: string, now: Date) {
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit"
  }).format(now);
  return { month, id: createHash("sha256").update(`${scope}:${month}`).digest("hex") };
}

export class GoogleSearchBudget {
  constructor(private readonly client: MongoClient, private readonly db: Db) {}

  async reserve(actor: Actor, requestId: string, limit: number, scope: string, now = new Date(), context?: LogContext, collectionJobId?: string) {
    const { id } = googleBudgetPeriod(scope, now);
    const receiptId = createHash("sha256").update(`${actor.workspaceId}:${actor.userId}:${requestId}`).digest("hex");
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        const receipts = this.db.collection<GoogleSearchRequest>("googleSearchRequests");
        if (await receipts.findOne({ _id: receiptId }, { session })) {
          throw new PortalError(409, "GOOGLE_REQUEST_ALREADY_USED",
            "Esta solicitação já foi utilizada. Confirme uma nova consulta se necessário; a mesma solicitação não será executada novamente.");
        }
        const budgets = this.db.collection<Budget>("googleSearchBudgets");
        await budgets.updateOne({ _id: id }, { $setOnInsert: { count: 0 } }, { upsert: true, session });
        const reserved = await budgets.updateOne({ _id: id, count: { $lt: limit } }, { $inc: { count: 1 } }, { session });
        if (reserved.modifiedCount !== 1) throw new PortalError(429, "GOOGLE_MONTHLY_LIMIT", "Limite mensal de consultas deste portal atingido. Nenhuma chamada foi realizada.");
        if (collectionJobId) {
          const job = await this.db.collection<{ _id: string; workspaceId: string; status: string; requestsMade: number; maxRequestsPerRun: number }>("collectionJobs")
            .updateOne({
              _id: collectionJobId, workspaceId: actor.workspaceId, status: "running",
              $expr: { $lt: ["$requestsMade", "$maxRequestsPerRun"] }
            }, { $inc: { requestsMade: 1 } }, { session });
          if (job.modifiedCount !== 1) {
            throw new PortalError(409, "COLLECTION_REQUEST_LIMIT", "O limite de requisições desta execução foi atingido ou a coleta não está em andamento. Nenhuma chamada foi realizada.");
          }
        }
        await receipts.insertOne({
          _id: receiptId, createdAt: now, workspaceId: actor.workspaceId, userId: actor.userId,
          ...(context ? { ...context, status: "pending" as const } : {})
        }, { session });
      }, { writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return receiptId;
  }
}
