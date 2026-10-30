import { z } from "zod";

export const collectionJobSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "running", "done", "failed"]),
  importedCount: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  hasMore: z.boolean().optional(),
  requestsMade: z.number().int().nonnegative().optional(),
  maxRequestsPerRun: z.number().int().positive().optional(),
  createdAt: z.iso.datetime().optional(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional()
});

export type CollectionJobInfo = z.infer<typeof collectionJobSchema>;
