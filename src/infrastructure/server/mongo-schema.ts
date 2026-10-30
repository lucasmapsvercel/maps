import type { Db } from "mongodb";

export async function ensurePortalIndexes(db: Db) {
  await Promise.all([
    db.collection("portalViews").createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
    db.collection("memberships").createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
    db.collection("auditEvents").createIndex({ workspaceId: 1, createdAt: -1 }),
    db.collection("commandReceipts").createIndex({ workspaceId: 1, userId: 1, commandId: 1 }, { unique: true }),
    db.collection("commandReceipts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("apiRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("collectionJobs").createIndex({ searchId: 1, workspaceId: 1, createdAt: -1 }),
    db.collection("collectionJobs").createIndex({ workspaceId: 1 })
  ]);
}

export async function migratePortal(db: Db) {
  const schemas = {
    portalWorkspaces: { required: ["_id", "version", "data", "updatedAt"], properties: {
      _id: { bsonType: "string" }, version: { bsonType: ["int", "long", "double"], minimum: 0 },
      data: { bsonType: "object" }, updatedAt: { bsonType: "date" }
    } },
    portalViews: { required: ["_id", "workspaceId", "userId", "data"], properties: {
      _id: { bsonType: "string" }, workspaceId: { bsonType: "string" }, userId: { bsonType: "string" }, data: { bsonType: "object" }
    } }
  };
  for (const [name, schema] of Object.entries(schemas)) {
    if (!(await db.listCollections({ name }).toArray()).length) await db.createCollection(name);
    await db.command({ collMod: name, validator: { $jsonSchema: { bsonType: "object", ...schema } }, validationLevel: "strict", validationAction: "error" });
  }
  await ensurePortalIndexes(db);
  await db.collection<{ _id: string; appliedAt: Date }>("schemaMigrations").updateOne(
    { _id: "portal-v1" }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true }
  );
}
