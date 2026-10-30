import { authenticatedApi, json } from "../../../../infrastructure/server/api";
import { ibgeMunicipalities } from "../../../../infrastructure/server/ibge-municipalities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return authenticatedApi(request, async () => json({ municipalities: await ibgeMunicipalities.list() }));
}
