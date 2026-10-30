import type { Db, MongoClient } from "mongodb";
import type { GooglePlacesProvider } from "../../application/google-search";
import { PortalError } from "../../application/portal-error";
import type { GoogleSearchResult } from "../../domain/google-search";
import type { GoogleSearchLog } from "../../domain/google-search-log";
import type { Actor } from "./auth";
import { GoogleSearchBudget, type GoogleSearchRequest } from "./google-search-budget";

interface SearchRequest {
  requestId: string;
  limit: number;
  billingScope: string;
  searchId: string;
  term: string;
  city: string;
  source: GoogleSearchLog["source"];
  pageToken?: string;
  collectionJobId?: string;
}

export class LoggedGoogleSearch {
  constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly provider: GooglePlacesProvider
  ) {}

  async search(actor: Actor, request: SearchRequest): Promise<GoogleSearchResult> {
    const id = await new GoogleSearchBudget(this.client, this.db).reserve(
      actor, request.requestId, request.limit, request.billingScope, new Date(), {
        actorName: actor.name, searchId: request.searchId, term: request.term, city: request.city,
        source: request.source, continuation: Boolean(request.pageToken)
      }, request.collectionJobId
    );
    const receipts = this.db.collection<GoogleSearchRequest>("googleSearchRequests");
    const started = performance.now();
    let result: GoogleSearchResult;
    try {
      result = await this.provider.search(request.term, request.city, request.pageToken);
    } catch (error) {
      await receipts.updateOne({ _id: id, workspaceId: actor.workspaceId }, { $set: {
        status: "failed", durationMs: Math.round(performance.now() - started),
        errorCode: error instanceof PortalError ? error.code : "INTERNAL_ERROR"
      } });
      throw error;
    }
    await receipts.updateOne({ _id: id, workspaceId: actor.workspaceId }, { $set: {
      status: "success", durationMs: Math.round(performance.now() - started), resultCount: result.places.length
    } });
    return result;
  }
}
