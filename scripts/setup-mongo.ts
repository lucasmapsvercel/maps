import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { MongoClient, MongoServerError } from "mongodb";
import { migratePortal } from "../src/infrastructure/server/mongo-schema.ts";

const database = process.env.MONGODB_DB_NAME || "MAPS";
if (!/^[a-zA-Z0-9_-]{1,63}$/.test(database)) throw new Error("Nome de banco invalido.");
const rootPassword = readFileSync("/run/secrets/mongo_root_password", "utf8").trimEnd();
const password = readFileSync("/run/secrets/mongodb_password", "utf8").trimEnd();
const client = new MongoClient(`mongodb://maps_root:${encodeURIComponent(rootPassword)}@mongo:27017/admin?directConnection=true`, {
  serverSelectionTimeoutMS: 5000
});

try {
  await client.connect();
  const admin = client.db("admin");
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 94) throw error;
    await admin.command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] } });
  }
  let primary = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await admin.command({ hello: 1 })).isWritablePrimary) { primary = true; break; }
    await setTimeout(1000);
  }
  if (!primary) throw new Error("Replica set nao elegeu primary em 60 segundos.");
  const db = client.db(database);
  const users = await db.command({ usersInfo: "maps" });
  if (!users.users.length) await db.command({ createUser: "maps", pwd: password, roles: [{ role: "readWrite", db: database }] });
  const app = new MongoClient(`mongodb://maps:${encodeURIComponent(password)}@mongo:27017/${database}?replicaSet=rs0&authSource=${database}`, { serverSelectionTimeoutMS: 5000 });
  try {
    await app.connect();
    await app.db(database).command({ ping: 1 });
  } finally {
    await app.close();
  }
  await migratePortal(db);
  console.log(JSON.stringify({ event: "mongo_initialized", replicaSet: "rs0", schema: "portal-v1" }));
} catch (error) {
  console.error(JSON.stringify({ event: "mongo_initialization_failed", errorType: error instanceof Error ? error.name : "Unknown" }));
  process.exitCode = 1;
} finally {
  await client.close();
}
