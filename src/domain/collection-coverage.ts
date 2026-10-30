import { z } from "zod";

export const collectionCoverageSchema = z.object({
  mode: z.enum(["neighborhoods", "municipality"]),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  current: z.string().min(1).optional(),
  catalogDate: z.string().regex(/^\d{4}$/).optional(),
  reason: z.enum(["catalog_unavailable", "legacy_cursor"]).optional()
}).refine((coverage) => coverage.completed <= coverage.total &&
  (coverage.mode === "neighborhoods" ? coverage.total > 0 : coverage.total === 0),
  "Progresso de bairros incompativel."
);

export type CollectionCoverage = z.infer<typeof collectionCoverageSchema>;
