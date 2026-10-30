import { z } from "zod";
import { PortalError } from "../../../../../application/portal-error";
import { authenticatedApi, json, readJson } from "../../../../../infrastructure/server/api";
import { mongoClient, mongoDatabase } from "../../../../../infrastructure/server/mongo";
import { MongoPortalStore } from "../../../../../infrastructure/server/mongo-portal-store";
import { validateCollectionRequest } from "../../../../../infrastructure/server/runtime-config";
import { consumeMutationLimit } from "../../../../../infrastructure/server/rate-limit";
import { secret } from "../../../../../infrastructure/server/config";
import { startCollectionJob, listCollectionJobs, serializeCollectionJob } from "../../../../../infrastructure/server/collection-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  searchId: z.string().min(1).max(100),
  confirmed: z.literal(true)
});

export function POST(request: Request) {
  return authenticatedApi(request, async (actor) => {
    validateCollectionRequest(process.env);
    const body = bodySchema.parse(await readJson(request));
    const client = await mongoClient();
    const db = await mongoDatabase();
    const snapshot = await new MongoPortalStore(client, db).load(actor);
    const search = snapshot.state.searches.find((s) => s.id === body.searchId);
    if (!search || search.demo) throw new PortalError(404, "SEARCH_NOT_FOUND", "Busca não encontrada neste workspace.");
    await consumeMutationLimit(db, actor);
    const jobId = await startCollectionJob(
      actor, search.id, search.term, search.city,
      secret("GOOGLE_PLACES_API_KEY"),
      secret("GOOGLE_PLACES_BILLING_SCOPE"),
      client, db
    );
    return json({ jobId }, 202);
  });
}

export function GET(request: Request) {
  return authenticatedApi(request, async (actor) => {
    const { searchParams } = new URL(request.url);
    const searchId = searchParams.get("searchId");
    if (!searchId) throw new PortalError(400, "MISSING_PARAM", "Parâmetro searchId obrigatório.");
    const db = await mongoDatabase();
    const jobs = await listCollectionJobs(searchId, actor.workspaceId, db);
    return json(jobs.map(serializeCollectionJob));
  });
}
