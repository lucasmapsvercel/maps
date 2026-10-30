import { PortalError } from "../../../../../application/portal-error";
import { authenticatedApi, json } from "../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../infrastructure/server/mongo";
import { validateCollectionRequest } from "../../../../../infrastructure/server/runtime-config";
import { secret } from "../../../../../infrastructure/server/config";
import { getQuotaUsage } from "../../../../../infrastructure/server/collection-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return authenticatedApi(request, async () => {
    validateCollectionRequest(process.env);
    const billingScope = secret("GOOGLE_PLACES_BILLING_SCOPE");
    const db = await mongoDatabase();
    const quota = await getQuotaUsage(billingScope, db);
    if (quota.limit === 0) throw new PortalError(503, "COLLECTION_BUDGET_REQUIRED", "Limite mensal não configurado.");
    return json(quota);
  });
}
