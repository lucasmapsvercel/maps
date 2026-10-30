import type { Db } from "mongodb";
import { collectionConfigSchema, DEFAULT_COLLECTION_REQUESTS } from "../../domain/collection-config";

export async function loadCollectionConfig(db: Db) {
  const doc = await db.collection<{ _id: string; maxRequestsPerRun?: number }>("collectionConfig").findOne({ _id: "global" });
  return collectionConfigSchema.parse({ maxRequestsPerRun: doc?.maxRequestsPerRun ?? DEFAULT_COLLECTION_REQUESTS });
}
