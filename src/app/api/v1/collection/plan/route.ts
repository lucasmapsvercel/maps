import { PortalError } from "../../../../../application/portal-error";
import { authenticatedApi, json } from "../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../infrastructure/server/mongo";
import { getCollectionCoverage } from "../../../../../infrastructure/server/collection-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return authenticatedApi(request, async (actor) => {
    const searchId = new URL(request.url).searchParams.get("searchId");
    if (!searchId) throw new PortalError(400, "MISSING_PARAM", "Parâmetro searchId obrigatório.");
    return json(await getCollectionCoverage(actor.workspaceId, searchId, await mongoDatabase()));
  });
}
