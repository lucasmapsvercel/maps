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
import { googleBudgetPeriod } from "./google-search-budget";

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
}

function cursorId(workspaceId: string, searchId: string) {
  return createHash("sha256").update(JSON.stringify([workspaceId, searchId])).digest("hex");
}

export async function startCollectionJob(
  actor: Actor,
  searchId: string, term: string, city: string,
  apiKey: string, billingScope: string,
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

  void processCollectionJob(jobId, apiKey, billingScope, client, db).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "collection_job_failure", jobId, errorType: error instanceof Error ? error.name : "Unknown" }));
  });
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
  db: Db
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
      await store.execute(actor, command, snapshot.version, commandId);
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

async function processCollectionJob(
  jobId: string, apiKey: string, billingScope: string,
  client: MongoClient, db: Db
): Promise<void> {
  const jobs = db.collection<CollectionJob>("collectionJobs");
  const cursors = db.collection<CollectionCursor>("collectionCursors");
  let collectedThisJob = 0;
  try {
    const claimed = await jobs.findOneAndUpdate(
      { _id: jobId, status: "pending" },
      { $set: { status: "running", startedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!claimed) return;
    const actor = { workspaceId: claimed.workspaceId, userId: claimed.userId, name: claimed.actorName };
    const loggedSearch = new LoggedGoogleSearch(client, db, new GoogleTextSearchProvider(apiKey));
    const limit = Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT) || 0;
    const cursor = await cursors.findOne({ _id: cursorId(actor.workspaceId, claimed.searchId), activeJobId: jobId });
    if (!cursor) throw new Error("Cursor da coleta não encontrado.");
    const snapshot = await new MongoPortalStore(client, db).load(actor);
    const search = snapshot.state.searches.find((item) => item.id === claimed.searchId);
    if (!search) throw new PortalError(404, "SEARCH_NOT_FOUND", "Busca não encontrada.");
    const knownIds = new Set(search.placeIds);
    let pageIndex = 0;
    let requestsMade = claimed.requestsMade;

    const fetchNextPage = async () => {
      const result = await loggedSearch.search(actor, {
        requestId: `${jobId}-p${requestsMade}`, searchId: claimed.searchId, term: claimed.term, city: claimed.city,
        source: "collection", limit, billingScope, pageToken: cursor.nextPageToken, collectionJobId: jobId
      });
      requestsMade++;
      if (result.nextPageToken && result.nextPageToken === cursor.nextPageToken) {
        throw new PortalError(502, "GOOGLE_PAGINATION_STALLED", "O Google repetiu o token de paginação. A coleta foi interrompida para evitar consultas repetidas.");
      }
      // Acrescentar e remover o prefixo são operações atômicas: a importação não apaga uma página recebida em paralelo.
      await cursors.updateOne({ _id: cursor._id, activeJobId: jobId }, {
        $push: { buffer: { $each: result.places } },
        $set: {
          exhausted: !result.nextPageToken,
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {})
        },
        ...(!result.nextPageToken ? { $unset: { nextPageToken: "" } } : {})
      }, { ignoreUndefined: true });
      cursor.buffer.push(...result.places);
      cursor.nextPageToken = result.nextPageToken;
      cursor.exhausted = !result.nextPageToken;
    };

    while (true) {
      if (cursor.buffer.length === 0) {
        if (cursor.exhausted || requestsMade >= claimed.maxRequestsPerRun) break;
        await fetchNextPage();
      }
      const page = cursor.buffer.slice(0, GOOGLE_TEXT_SEARCH_PAGE_SIZE);
      const batch = page.filter((place, index, places) =>
        !knownIds.has(place.id) && places.findIndex((item) => item.id === place.id) === index);
      const importCurrentPage = async () => {
        if (batch.length > 0) {
          await importPage(actor, batch, claimed.searchId, `${jobId}-import${pageIndex}`, client, db);
          for (const place of batch) knownIds.add(place.id);
          collectedThisJob += batch.length;
        };
        if (page.length > 0) {
          await cursors.updateOne({ _id: cursor._id, activeJobId: jobId }, [{
            $set: { buffer: { $slice: ["$buffer", page.length, { $add: [{ $size: "$buffer" }, 1] }] } }
          }]);
          cursor.buffer = cursor.buffer.slice(page.length);
        }
        await jobs.updateOne({ _id: jobId }, { $set: { collectedSoFar: collectedThisJob } });
      }
      const canPrefetch = !cursor.exhausted && requestsMade < claimed.maxRequestsPerRun &&
        cursor.buffer.length <= GOOGLE_TEXT_SEARCH_PAGE_SIZE;
      // Aguarda ambas antes de encerrar o job ou liberar seu cursor, inclusive em caso de falha.
      const [imported, fetched] = await Promise.allSettled([
        importCurrentPage(), canPrefetch ? fetchNextPage() : Promise.resolve()
      ]);
      if (imported.status === "rejected") throw imported.reason;
      if (fetched.status === "rejected") throw fetched.reason;
      pageIndex++;
    }

    await jobs.updateOne({ _id: jobId }, {
      $set: {
        status: "done", finishedAt: new Date(), importedCount: collectedThisJob,
        hasMore: cursor.buffer.length > 0 || !cursor.exhausted
      }
    });
  } catch (error) {
    const message = error instanceof PortalError ? error.message
      : error instanceof Error ? error.message
      : "Erro interno ao processar a coleta.";
    await jobs.updateOne({ _id: jobId }, {
      $set: { status: "failed", finishedAt: new Date(), error: message, collectedSoFar: collectedThisJob }
    });
  } finally {
    await cursors.updateOne({ activeJobId: jobId }, { $unset: { activeJobId: "" } });
  }
}
