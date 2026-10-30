import { z } from "zod";

export const GOOGLE_TEXT_SEARCH_PAGE_SIZE = 20;
export const MAX_COLLECTION_REQUESTS = 5000;
export const DEFAULT_COLLECTION_REQUESTS = 100;

export const collectionConfigSchema = z.strictObject({
  maxRequestsPerRun: z.number().int().min(1).max(MAX_COLLECTION_REQUESTS)
});
