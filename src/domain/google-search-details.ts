import { z } from "zod";

export const googleSearchDetailsSchema = z.object({
  request: z.object({
    method: z.literal("POST"),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.json()
  }),
  response: z.object({
    httpStatus: z.number().int().nullable(),
    contentType: z.string().nullable(),
    body: z.json(),
    errorCode: z.string().optional(),
    truncated: z.boolean()
  }).optional()
});

export const googleSearchDetailsResponseSchema = googleSearchDetailsSchema.extend({
  expiresAt: z.iso.datetime()
});

export type GoogleSearchDetails = z.infer<typeof googleSearchDetailsSchema>;
export type GoogleSearchObserver = (details: GoogleSearchDetails) => Promise<void>;
