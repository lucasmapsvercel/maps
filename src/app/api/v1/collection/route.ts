import { authenticatedApi } from "../../../../infrastructure/server/api";
import { validateCollectionRequest } from "../../../../infrastructure/server/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return authenticatedApi(request, async () => validateCollectionRequest(process.env));
}
