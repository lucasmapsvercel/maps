import { z } from "zod";

const attributionSchema = z.object({
  provider: z.string().max(500),
  providerUri: z.url().refine((value) => new URL(value).protocol === "https:").optional()
});

export const googleSearchResultSchema = z.object({
  places: z.array(z.object({
    id: z.string().min(1).max(500),
    name: z.string().max(1000),
    address: z.string().max(2000),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    attributions: z.array(attributionSchema)
  })).max(20),
  expiresAt: z.iso.datetime(),
  limited: z.boolean()
});

export type GoogleSearchResult = z.infer<typeof googleSearchResultSchema>;
