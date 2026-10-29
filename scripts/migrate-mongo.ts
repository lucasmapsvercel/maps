import { MongoClient } from "mongodb";
import { migratePortal } from "../src/infrastructure/server/mongo-schema.ts";

const uri = process.env.MONGODB_URI;
const database = process.env.MONGODB_DB_NAME || "MAPS";
if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
  throw new Error("Configure MONGODB_URI privadamente em .env.migrate.");
}
if (!/^[a-zA-Z0-9_-]{1,63}$/.test(database)) throw new Error("Nome de banco invalido.");

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 2 });
try {
  await client.connect();
  await migratePortal(client.db(database));
  console.log(JSON.stringify({ event: "migration_completed", schema: "portal-v1" }));
} catch (error) {
  console.error(JSON.stringify({
    event: "migration_failed",
    errorType: error instanceof Error ? error.name : "Unknown",
    code: error !== null && typeof error === "object" && "code" in error ? error.code : undefined
  }));
  process.exitCode = 1;
} finally {
  await client.close();
}
