import { validateServerConfig } from "../../../infrastructure/server/config";
import { mongoDatabase } from "../../../infrastructure/server/mongo";
import { json } from "../../../infrastructure/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    validateServerConfig();
    const db = await mongoDatabase();
    await db.command({ ping: 1 });
    const migration = await db.collection<{ _id: string }>("schemaMigrations").findOne({ _id: "portal-v1" });
    if (!migration) return json({ status: "not_ready", code: "MIGRATION_REQUIRED" }, 503);
    return json({ status: "ready", database: "ok", collection: "blocked" });
  } catch (error) {
    console.error(JSON.stringify({ event: "readiness_failed", errorType: error instanceof Error ? error.name : "Unknown" }));
    return json({ status: "not_ready", code: "CONFIGURATION_OR_DATABASE_UNAVAILABLE" }, 503);
  }
}
