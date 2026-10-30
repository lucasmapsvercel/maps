import { authenticatedApi, json } from "../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../infrastructure/server/mongo";
import type { GoogleSearchRequest } from "../../../../../infrastructure/server/google-search-budget";
import { googleSearchLogSchema } from "../../../../../domain/google-search-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return authenticatedApi(request, async (actor) => {
    const db = await mongoDatabase();
    const receipts = await db.collection<GoogleSearchRequest>("googleSearchRequests")
      .find({ workspaceId: actor.workspaceId, status: { $exists: true } })
      .sort({ createdAt: -1, _id: -1 }).limit(100).toArray();
    const logs = receipts.map((receipt) => googleSearchLogSchema.parse({
      id: receipt._id, createdAt: receipt.createdAt.toISOString(), actorName: receipt.actorName,
      searchId: receipt.searchId, term: receipt.term, city: receipt.city,
      source: receipt.source, continuation: receipt.continuation, status: receipt.status,
      durationMs: receipt.durationMs, resultCount: receipt.resultCount, errorCode: receipt.errorCode
    }));
    return json({ logs });
  });
}
