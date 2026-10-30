import { randomUUID } from "node:crypto";
import type { Db, MongoClient } from "mongodb";
import { PortalError } from "../../application/portal-error";
import { MongoPortalStore } from "./mongo-portal-store";
import { GoogleTextSearchProvider } from "./google-places-provider";
import { GoogleSearchBudget } from "./google-search-budget";

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface CollectionJob {
  _id: string;
  workspaceId: string;
  userId: string;
  actorName: string;
  searchId: string;
  term: string;
  city: string;
  status: JobStatus;
  targetCount: number;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  importedCount?: number;
  /** nextPageToken salvo após cada página bem-sucedida — permite retomar em um novo job. */
  resumeToken?: string;
  /** Quantos lugares foram importados até o momento pelo job atual. */
  collectedSoFar?: number;
}

interface CollectionConfig {
  _id: string;
  maxResultsPerSearch?: number;
}

async function loadCollectionConfig(db: Db): Promise<{ maxResultsPerSearch: number }> {
  const doc = await db.collection<CollectionConfig>("collectionConfig").findOne({ _id: "global" });
  return { maxResultsPerSearch: doc?.maxResultsPerSearch ?? 100 };
}

export async function startCollectionJob(
  actor: { workspaceId: string; userId: string; name: string },
  searchId: string, term: string, city: string,
  apiKey: string, billingScope: string,
  client: MongoClient, db: Db
): Promise<string> {
  const config = await loadCollectionConfig(db);

  // Se houver um job recente com falha para a mesma busca e um token de retomada
  // válido (tokens expiram em ~60 min), o novo job continua de onde parou.
  const cutoff = new Date(Date.now() - 55 * 60000);
  const resumeSource = await db.collection<CollectionJob>("collectionJobs").findOne(
    { searchId, workspaceId: actor.workspaceId, status: "failed", resumeToken: { $exists: true }, finishedAt: { $gt: cutoff } },
    { sort: { createdAt: -1 } }
  );

  const jobId = randomUUID();
  await db.collection<CollectionJob>("collectionJobs").insertOne({
    _id: jobId,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    actorName: actor.name,
    searchId, term, city,
    status: "pending",
    targetCount: config.maxResultsPerSearch,
    resumeToken: resumeSource?.resumeToken,
    collectedSoFar: 0,
    createdAt: new Date()
  });

  void processCollectionJob(jobId, apiKey, billingScope, client, db);
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

export async function getQuotaUsage(billingScope: string, db: Db, now = new Date()) {
  const { createHash } = await import("node:crypto");
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit"
  }).format(now);
  const id = createHash("sha256").update(`${billingScope}:${month}`).digest("hex");
  const [budget, config] = await Promise.all([
    db.collection<{ _id: string; count: number }>("googleSearchBudgets").findOne({ _id: id }),
    loadCollectionConfig(db)
  ]);
  const limit = Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT) || 0;
  const used = budget?.count ?? 0;
  const callsPerSearch = Math.ceil(config.maxResultsPerSearch / 20);
  return {
    used, limit, remaining: Math.max(0, limit - used), month,
    maxResultsPerSearch: config.maxResultsPerSearch,
    callsPerSearch
  };
}

async function importPage(
  actor: { workspaceId: string; userId: string; name: string },
  places: Array<{ id: string; name: string; address: string; category?: string; latitude?: number; longitude?: number; phone?: string; website?: string }>,
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

  const claimed = await jobs.findOneAndUpdate(
    { _id: jobId, status: "pending" },
    { $set: { status: "running", startedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!claimed) return;

  const actor = { workspaceId: claimed.workspaceId, userId: claimed.userId, name: claimed.actorName };
  const provider = new GoogleTextSearchProvider(apiKey);
  const budget = new GoogleSearchBudget(client, db);
  const limit = Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT) || 0;

  let collectedThisJob = 0;
  let currentPageToken: string | undefined = claimed.resumeToken;
  // Se estamos retomando, começamos o índice de página a partir de 1 para que
  // os IDs de idempotência não colidam com os do job anterior.
  let pageIndex = claimed.resumeToken ? 1 : 0;

  try {
    while (collectedThisJob < claimed.targetCount) {
      const pageId = `${jobId}-p${pageIndex}`;

      // Reserva 1 cota por chamada de página — reflete o modelo de cobrança do Google.
      await budget.reserve(actor, pageId, limit, billingScope);

      const result = await provider.search(claimed.term, claimed.city, currentPageToken);

      if (result.places.length === 0) break;

      // Persiste o progresso antes de importar — se a importação falhar, o token fica salvo.
      await jobs.updateOne({ _id: jobId }, {
        $set: {
          resumeToken: result.nextPageToken,
          collectedSoFar: collectedThisJob + result.places.length
        }
      });

      await importPage(actor, result.places, claimed.searchId, pageId, client, db);

      collectedThisJob += result.places.length;

      if (!result.nextPageToken) break;
      currentPageToken = result.nextPageToken;
      pageIndex++;
    }

    await jobs.updateOne({ _id: jobId }, {
      $set: { status: "done", finishedAt: new Date(), importedCount: collectedThisJob },
      $unset: { resumeToken: "" }
    });
  } catch (error) {
    const message = error instanceof PortalError ? error.message
      : error instanceof Error ? error.message
      : "Erro interno ao processar a coleta.";
    // resumeToken é preservado para que um novo job possa continuar daqui.
    await jobs.updateOne({ _id: jobId }, {
      $set: { status: "failed", finishedAt: new Date(), error: message, collectedSoFar: collectedThisJob }
    });
  }
}
