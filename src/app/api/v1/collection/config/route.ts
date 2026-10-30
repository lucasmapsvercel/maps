import { z } from "zod";
import { authenticatedApi, json, readJson } from "../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../infrastructure/server/mongo";
import { validateCollectionRequest } from "../../../../../infrastructure/server/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS_CEILING = 500;

export function GET(request: Request) {
  return authenticatedApi(request, async () => {
    validateCollectionRequest(process.env);
    const db = await mongoDatabase();
    const doc = await db.collection<{ _id: string; maxResultsPerSearch?: number }>("collectionConfig").findOne({ _id: "global" });
    return json({ maxResultsPerSearch: doc?.maxResultsPerSearch ?? 100 });
  });
}

export function PUT(request: Request) {
  return authenticatedApi(request, async () => {
    validateCollectionRequest(process.env);
    const body = z.object({
      maxResultsPerSearch: z.number().int().min(1).max(MAX_RESULTS_CEILING)
    }).parse(await readJson(request));
    const db = await mongoDatabase();
    await db.collection<{ _id: string; maxResultsPerSearch?: number; updatedAt?: Date }>("collectionConfig").updateOne(
      { _id: "global" },
      { $set: { maxResultsPerSearch: body.maxResultsPerSearch, updatedAt: new Date() } },
      { upsert: true }
    );
    return json({ maxResultsPerSearch: body.maxResultsPerSearch });
  });
}
