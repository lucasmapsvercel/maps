import { z } from "zod";

export const GOOGLE_TEXT_SEARCH_PAGE_SIZE = 20;
export const MAX_COLLECTION_REQUESTS = 5000;
export const DEFAULT_COLLECTION_REQUESTS = 100;

export const collectionConfigSchema = z.strictObject({
  maxRequestsPerRun: z.number().int().min(1).max(MAX_COLLECTION_REQUESTS)
});

export const collectionQuotaSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  month: z.string(),
  maxRequestsPerRun: collectionConfigSchema.shape.maxRequestsPerRun,
  resultsPerRequest: z.literal(GOOGLE_TEXT_SEARCH_PAGE_SIZE)
});

export type CollectionQuota = z.infer<typeof collectionQuotaSchema>;
