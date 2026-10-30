import { z } from "zod";

export const googleSearchLogSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  actorName: z.string(),
  searchId: z.string(),
  term: z.string(),
  city: z.string(),
  source: z.enum(["direct", "collection"]),
  continuation: z.boolean(),
  status: z.enum(["pending", "success", "failed"]),
  durationMs: z.number().nonnegative().optional(),
  resultCount: z.number().int().nonnegative().optional(),
  errorCode: z.string().optional()
});

export const googleSearchLogsResponseSchema = z.object({
  logs: z.array(googleSearchLogSchema).max(100)
});

export type GoogleSearchLog = z.infer<typeof googleSearchLogSchema>;
