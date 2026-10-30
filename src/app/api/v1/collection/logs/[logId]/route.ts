import { PortalError } from "../../../../../../application/portal-error";
import { authenticatedApi, json } from "../../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../../infrastructure/server/mongo";
import type { GoogleSearchDetailsDocument } from "../../../../../../infrastructure/server/logged-google-search";
import { googleSearchDetailsResponseSchema } from "../../../../../../domain/google-search-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params;
  return authenticatedApi(request, async (actor) => {
    const db = await mongoDatabase();
    const details = await db.collection<GoogleSearchDetailsDocument>("googleSearchDetails").findOne({
      _id: logId, workspaceId: actor.workspaceId, expiresAt: { $gt: new Date() }
    });
    if (!details) throw new PortalError(404, "GOOGLE_LOG_DETAILS_UNAVAILABLE",
      "Detalhes indisponíveis: consulta antiga, captura ainda não iniciada ou retenção de 30 dias expirada.");
    return json(googleSearchDetailsResponseSchema.parse({
      request: details.request, response: details.response, expiresAt: details.expiresAt.toISOString()
    }));
  });
}
