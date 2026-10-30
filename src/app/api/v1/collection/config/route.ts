import { collectionConfigSchema } from "../../../../../domain/collection-config";
import { loadCollectionConfig } from "../../../../../infrastructure/server/collection-config";
import { authenticatedApi, json, readJson } from "../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../infrastructure/server/mongo";
import { validateCollectionRequest } from "../../../../../infrastructure/server/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return authenticatedApi(request, async () => {
    validateCollectionRequest(process.env);
    const db = await mongoDatabase();
    return json(await loadCollectionConfig(db));
  });
}

export function PUT(request: Request) {
  return authenticatedApi(request, async () => {
    validateCollectionRequest(process.env);
    const body = collectionConfigSchema.parse(await readJson(request));
    const db = await mongoDatabase();
    await db.collection<{ _id: string; maxRequestsPerRun?: number; updatedAt?: Date }>("collectionConfig").updateOne(
      { _id: "global" },
      {
        $set: { maxRequestsPerRun: body.maxRequestsPerRun, updatedAt: new Date() },
        $unset: { maxResultsPerSearch: "" }
      },
      { upsert: true }
    );
    return json(body);
  });
}
