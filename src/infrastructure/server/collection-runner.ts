import { createHash, randomUUID } from "node:crypto";
import { MongoServerError, type Db, type MongoClient } from "mongodb";
import type { GoogleSearchResult } from "../../domain/google-search";
import type { SavedSearch } from "../../domain/types";
import type { CollectionJobInfo } from "../../domain/collection-job";
import type { Actor } from "./auth";
import { PortalError } from "../../application/portal-error";
import { MongoPortalStore } from "./mongo-portal-store";
import { GoogleTextSearchProvider } from "./google-places-provider";
import { LoggedGoogleSearch } from "./logged-google-search";
import { loadCollectionConfig } from "./collection-config";
import { GOOGLE_TEXT_SEARCH_PAGE_SIZE, type CollectionQuota } from "../../domain/collection-config";
import { googleBudgetPeriod, type GoogleSearchRequest } from "./google-search-budget";
import { enqueueCollectionWorkflow } from "./collection-workflow-start";

export interface CollectionJob extends Omit<CollectionJobInfo, "id" | "createdAt" | "startedAt" | "finishedAt"> {
  _id: string;
  workspaceId: string;
  userId: string;
  actorName: string;
  searchId: string;
  term: string;
  city: string;
  maxRequestsPerRun: number;
  requestsMade: number;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  workflowVersion?: number;
  workflowRunId?: string;
  billingScope?: string;
  importedPages?: number;
  updatedAt?: Date;
}

export function serializeCollectionJob(job: CollectionJob): CollectionJobInfo {
  return {
    id: job._id, status: job.status, importedCount: job.importedCount, error: job.error, hasMore: job.hasMore,
    requestsMade: job.requestsMade, maxRequestsPerRun: job.maxRequestsPerRun,
    collectedSoFar: job.collectedSoFar,
    createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString(), finishedAt: job.finishedAt?.toISOString()
  };
}

interface CollectionCursor {
  _id: string;
  workspaceId: string;
  searchId: string;
  activeJobId?: string;
  nextPageToken?: string;
  buffer: GoogleSearchResult["places"];
  exhausted: boolean;
  lastRequestId?: string;
  blocked?: boolean;
}

function cursorId(workspaceId: string, searchId: string) {
  return createHash("sha256").update(JSON.stringify([workspaceId, searchId])).digest("hex");
}

export async function startCollectionJob(
  actor: Actor,
  searchId: string, term: string, city: string,
  _apiKey: string, billingScope: string,
  client: MongoClient, db: Db
): Promise<string> {
  const config = await loadCollectionConfig(db);

  const jobs = db.collection<CollectionJob>("collectionJobs");
  const cursors = db.collection<CollectionCursor>("collectionCursors");
  const id = cursorId(actor.workspaceId, searchId);
  const latest = await jobs.findOne(
    { searchId, workspaceId: actor.workspaceId },
    { sort: { createdAt: -1 } }
  );
  const jobId = randomUUID();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const workspaces = db.collection<{ _id: string; data: { searches: SavedSearch[] }; updatedAt: Date }>("portalWorkspaces");
      const workspace = await workspaces.findOne({ _id: actor.workspaceId }, { session });
      const search = workspace?.data.searches.find((item) => item.id === searchId);
      if (!search || search.demo) throw new PortalError(404, "SEARCH_NOT_FOUND", "Busca não encontrada.");
      // Serializa o início da coleta com a exclusão da busca no agregado.
      await workspaces.updateOne({ _id: actor.workspaceId }, { $set: { updatedAt: new Date() } }, { session });
      let cursor = await cursors.findOne({ _id: id }, { session });
      if (!cursor) {
        if (latest || search.placeIds.length > 0) {
          throw new PortalError(409, "COLLECTION_CURSOR_UNAVAILABLE",
            "Esta busca antiga não possui continuação confiável salva. Não reiniciamos a consulta para evitar repetições. Crie uma nova busca para iniciar uma sequência paginada.");
        }
        cursor = { _id: id, workspaceId: actor.workspaceId, searchId, buffer: [], exhausted: false };
        await cursors.insertOne(cursor, { session });
      }
      if (cursor.activeJobId) throw new PortalError(409, "COLLECTION_ALREADY_RUNNING", "Já existe uma coleta em andamento para esta busca.");
      if (cursor.blocked && cursor.buffer.length === 0) throw new PortalError(409, "COLLECTION_RESPONSE_UNCERTAIN",
        "Esta busca possui uma chamada sem resposta salva. Crie uma nova busca; não repetimos automaticamente uma chamada de resultado incerto.");
      if (cursor.exhausted && cursor.buffer.length === 0) {
        throw new PortalError(409, "COLLECTION_EXHAUSTED", "O Google não disponibilizou mais resultados para esta busca.");
      }
      await cursors.updateOne({ _id: id }, { $set: { activeJobId: jobId } }, { session });
      await jobs.insertOne({
        _id: jobId,
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        actorName: actor.name,
        searchId, term, city,
        status: "pending",
        maxRequestsPerRun: config.maxRequestsPerRun,
        requestsMade: 0,
        collectedSoFar: 0,
        importedPages: 0,
        workflowVersion: 1,
        billingScope,
        createdAt: new Date()
      }, { session });
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new PortalError(409, "COLLECTION_ALREADY_RUNNING", "Já existe uma coleta em andamento para esta busca.");
    }
    throw error;
  } finally {
    await session.endSession();
  }

  let runId: string;
  try {
    runId = await enqueueCollectionWorkflow(jobId);
  } catch (error) {
    await finishCollectionJob(jobId, client, db, "Não foi possível agendar a coleta. Tente novamente.", true);
    console.error(JSON.stringify({ event: "collection_enqueue_failure", jobId, errorType: error instanceof Error ? error.name : "Unknown" }));
    throw new PortalError(503, "COLLECTION_ENQUEUE_FAILED", "Não foi possível agendar a coleta. Verifique o progresso antes de tentar novamente.");
  }
  await jobs.updateOne({ _id: jobId }, { $set: { workflowRunId: runId } });
  return jobId;
}

export async function getCollectionJob(jobId: string, workspaceId: string, db: Db): Promise<CollectionJob | null> {
  return db.collection<CollectionJob>("collectionJobs").findOne({ _id: jobId, workspaceId });
}

export async function listCollectionJobs(searchId: string, workspaceId: string, db: Db): Promise<CollectionJob[]> {
  return db.collection<CollectionJob>("collectionJobs")
    .find({ searchId, workspaceId }, { sort: { createdAt: -1 }, limit: 10 })
    .toArray();
}

export async function getQuotaUsage(billingScope: string, db: Db, now = new Date()): Promise<CollectionQuota> {
  const { id, month } = googleBudgetPeriod(billingScope, now);
  const [budget, config] = await Promise.all([
    db.collection<{ _id: string; count: number }>("googleSearchBudgets").findOne({ _id: id }),
    loadCollectionConfig(db)
  ]);
  const limit = Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT) || 0;
  const used = budget?.count ?? 0;
  return {
    used, limit, remaining: Math.max(0, limit - used), month,
    maxRequestsPerRun: config.maxRequestsPerRun,
    resultsPerRequest: GOOGLE_TEXT_SEARCH_PAGE_SIZE
  };
}

async function importPage(
  actor: Actor,
  places: GoogleSearchResult["places"],
  searchId: string,
  commandId: string,
  client: MongoClient,
  db: Db,
  checkpoint: { jobId: string; importIndex: number; pageIds: string[] }
) {
  const command = {
    type: "importPlaces" as const,
    searchId,
    places: places.map((p) => ({
      id: p.id, name: p.name, address: p.address, category: p.category || "",
      ...(p.latitude !== undefined ? { latitude: p.latitude } : {}),
      ...(p.longitude !== undefined ? { longitude: p.longitude } : {}),
      ...(p.phone ? { phone: p.phone } : {}),
      ...(p.website ? { website: p.website } : {})
    }))
  };
  const store = new MongoPortalStore(client, db);
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await store.load(actor);
    try {
      await store.execute(actor, command, snapshot.version, commandId, checkpoint);
      return;
    } catch (e) {
      if (e instanceof PortalError && e.code === "VERSION_CONFLICT" && attempt < 4) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

export async function prepareCollectionJob(jobId: string, db: Db) {
  await db.collection<CollectionJob>("collectionJobs").updateOne(
    { _id: jobId, status: "pending", workflowVersion: 1 },
    { $set: { status: "running", startedAt: new Date(), updatedAt: new Date() } }
  );
}

async function runningCollection(jobId: string, db: Db) {
  const job = await db.collection<CollectionJob>("collectionJobs").findOne({ _id: jobId, status: "running", workflowVersion: 1 });
  if (!job) return null;
  const cursor = await db.collection<CollectionCursor>("collectionCursors").findOne({
    _id: cursorId(job.workspaceId, job.searchId), activeJobId: jobId
  });
  if (!cursor) throw new PortalError(409, "COLLECTION_CURSOR_UNAVAILABLE", "Cursor da coleta não encontrado.");
  return { job, cursor, actor: { workspaceId: job.workspaceId, userId: job.userId, name: job.actorName } };
}

export async function planCollectionJob(jobId: string, db: Db) {
  const active = await runningCollection(jobId, db);
  if (!active) return null;
  const { job, cursor } = active;
  if (cursor.blocked && cursor.buffer.length === 0) {
    throw new PortalError(409, "COLLECTION_RESPONSE_UNCERTAIN",
      "Uma chamada anterior foi interrompida sem resposta salva. Os dados recebidos foram preservados. Crie uma nova busca; não repetimos automaticamente uma chamada de resultado incerto.");
  }
  const fetchPage = !cursor.blocked && !cursor.exhausted && job.requestsMade < job.maxRequestsPerRun &&
    cursor.buffer.length <= GOOGLE_TEXT_SEARCH_PAGE_SIZE;
  return {
    done: cursor.buffer.length === 0 && !fetchPage,
    importPage: cursor.buffer.length > 0, fetchPage,
    requestIndex: job.requestsMade, importIndex: job.importedPages ?? 0
  };
}

export async function fetchCollectionPage(jobId: string, requestIndex: number, apiKey: string, client: MongoClient, db: Db) {
  const active = await runningCollection(jobId, db);
  if (!active) return;
  const { job, cursor, actor } = active;
  const requestId = `${jobId}-p${requestIndex}`;
  if (cursor.lastRequestId === requestId) return;
  if (cursor.blocked) throw new PortalError(409, "COLLECTION_RESPONSE_UNCERTAIN", "A continuação desta busca requer revisão; uma chamada anterior ficou sem resposta salva.");
  const receiptId = createHash("sha256").update(`${actor.workspaceId}:${actor.userId}:${requestId}`).digest("hex");
  if (await db.collection<GoogleSearchRequest>("googleSearchRequests").findOne({ _id: receiptId })) {
    await db.collection<CollectionCursor>("collectionCursors").updateOne({ _id: cursor._id, activeJobId: jobId }, { $set: { blocked: true } });
    throw new PortalError(409, "COLLECTION_RESPONSE_UNCERTAIN",
      "Uma chamada foi contabilizada, mas sua página não foi salva. Não repetimos essa chamada automaticamente. Crie uma nova busca para consultar novamente.");
  }
  if (job.requestsMade !== requestIndex) throw new PortalError(409, "COLLECTION_CHECKPOINT_CONFLICT", "O progresso da coleta mudou. Nenhuma nova chamada foi realizada.");
  const result = await new LoggedGoogleSearch(client, db, new GoogleTextSearchProvider(apiKey)).search(actor, {
    requestId, searchId: job.searchId, term: job.term, city: job.city,
    source: "collection", limit: Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT) || 0,
    billingScope: job.billingScope ?? missingBillingScope(), pageToken: cursor.nextPageToken, collectionJobId: jobId
  });
  if (result.nextPageToken && result.nextPageToken === cursor.nextPageToken) {
    await db.collection<CollectionCursor>("collectionCursors").updateOne({ _id: cursor._id, activeJobId: jobId }, { $set: { blocked: true } });
    throw new PortalError(502, "GOOGLE_PAGINATION_STALLED", "O Google repetiu o token de paginação. A coleta foi interrompida para evitar consultas repetidas.");
  }
  const saved = await db.collection<CollectionCursor>("collectionCursors").updateOne(
    { _id: cursor._id, activeJobId: jobId, lastRequestId: { $ne: requestId } },
    {
      $push: { buffer: { $each: result.places } },
      $set: { lastRequestId: requestId, exhausted: !result.nextPageToken,
        ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}) },
      ...(!result.nextPageToken ? { $unset: { nextPageToken: "" } } : {})
    }, { ignoreUndefined: true }
  );
  if (!saved.matchedCount) throw new PortalError(409, "COLLECTION_CHECKPOINT_CONFLICT", "Não foi possível salvar a página no cursor ativo.");
}

function missingBillingScope(): never {
  throw new PortalError(503, "COLLECTION_CONFIGURATION_INVALID", "A coleta não possui escopo de orçamento salvo.");
}

export async function importCollectionPage(jobId: string, importIndex: number, client: MongoClient, db: Db) {
  const active = await runningCollection(jobId, db);
  if (!active) return;
  const { job, cursor, actor } = active;
  if ((job.importedPages ?? 0) > importIndex) return;
  if ((job.importedPages ?? 0) !== importIndex) throw new PortalError(409, "COLLECTION_CHECKPOINT_CONFLICT", "Checkpoint de importação incompatível.");
  const page = cursor.buffer.slice(0, GOOGLE_TEXT_SEARCH_PAGE_SIZE);
  if (!page.length) return;
  const snapshot = await new MongoPortalStore(client, db).load(actor);
  const search = snapshot.state.searches.find((item) => item.id === job.searchId);
  if (!search) throw new PortalError(404, "SEARCH_NOT_FOUND", "Busca não encontrada.");
  const knownIds = new Set(search.placeIds);
  const batch = page.filter((place, index) => !knownIds.has(place.id) && page.findIndex((item) => item.id === place.id) === index);
  await importPage(actor, batch, job.searchId, `${jobId}-import${importIndex}`, client, db,
    { jobId, importIndex, pageIds: page.map((item) => item.id) });
}

export async function finishCollectionJob(jobId: string, client: MongoClient, db: Db, error?: string, pendingOnly = false) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const jobs = db.collection<CollectionJob>("collectionJobs");
      const job = await jobs.findOne({ _id: jobId, status: pendingOnly ? "pending" : { $in: ["pending", "running"] } }, { session });
      if (!job) return;
      const cursors = db.collection<CollectionCursor>("collectionCursors");
      const cursor = await cursors.findOne({ activeJobId: jobId }, { session });
      await jobs.updateOne({ _id: jobId }, { $set: {
        status: error ? "failed" : "done", finishedAt: new Date(), importedCount: job.collectedSoFar ?? 0,
        ...(error ? { error } : { hasMore: Boolean(cursor && (cursor.buffer.length > 0 || !cursor.exhausted)) })
      } }, { session });
      await cursors.updateOne({ activeJobId: jobId }, { $unset: { activeJobId: "" } }, { session });
    });
  } finally { await session.endSession(); }
}
