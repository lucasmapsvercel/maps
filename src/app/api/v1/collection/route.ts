import { z } from "zod";
import { PortalError } from "../../../../application/portal-error";
import { authenticatedApi, json, readJson } from "../../../../infrastructure/server/api";
import { validateCollectionRequest } from "../../../../infrastructure/server/runtime-config";
import { mongoClient, mongoDatabase } from "../../../../infrastructure/server/mongo";
import { MongoPortalStore } from "../../../../infrastructure/server/mongo-portal-store";
import { GoogleSearchBudget } from "../../../../infrastructure/server/google-search-budget";
import { GoogleTextSearchProvider } from "../../../../infrastructure/server/google-places-provider";
import { consumeMutationLimit } from "../../../../infrastructure/server/rate-limit";
import { secret } from "../../../../infrastructure/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.strictObject({ searchId: z.string().min(1).max(100), requestId: z.uuid(), confirmed: z.literal(true) });

export function POST(request: Request) {
  return authenticatedApi(request, async (actor) => {
    validateCollectionRequest(process.env);
    const body = schema.parse(await readJson(request));
    const apiKey = secret("GOOGLE_PLACES_API_KEY");
    const client = await mongoClient();
    const db = await mongoDatabase();
    const snapshot = await new MongoPortalStore(client, db).load(actor);
    const search = snapshot.state.searches.find((item) => item.id === body.searchId);
    if (!search || search.demo) throw new PortalError(404, "SEARCH_NOT_FOUND", "Busca não encontrada neste workspace.");
    await consumeMutationLimit(db, actor);
    await new GoogleSearchBudget(client, db).reserve(actor, body.requestId,
      Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT), secret("GOOGLE_PLACES_BILLING_SCOPE"));
    const result = await new GoogleTextSearchProvider(apiKey).search(search.term, search.city);
    return json(result);
  });
}
