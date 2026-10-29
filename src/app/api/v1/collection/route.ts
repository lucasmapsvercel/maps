import { authenticatedApi, json } from "../../../../infrastructure/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return authenticatedApi(request, async () => json({
    code: "COLLECTION_NOT_CONFIGURED",
    error: "Coleta bloqueada: defina uma fonte autorizada, política de retenção e limites de requisições e custo antes da integração."
  }, 409));
}
