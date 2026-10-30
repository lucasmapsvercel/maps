// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoPortalStore } from "../src/infrastructure/server/mongo-portal-store";
import { migratePortal } from "../src/infrastructure/server/mongo-schema";
import { createDemoState } from "../src/infrastructure/demo-state";
import { consumeMutationLimit } from "../src/infrastructure/server/rate-limit";
import * as auth from "../src/infrastructure/server/auth";
import { GET, POST } from "../src/app/api/v1/portal/route";
import { POST as collect } from "../src/app/api/v1/collection/route";
import { mongoClient } from "../src/infrastructure/server/mongo";
import { GoogleSearchBudget } from "../src/infrastructure/server/google-search-budget";

let server: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let store: MongoPortalStore;
const alice = { workspaceId: "workspace-a", userId: "google-alice", name: "Alice Test" };
const bob = { ...alice, userId: "google-bob", name: "Bob Test" };
const outsider = { ...bob, workspaceId: "workspace-b" };

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("MAPS_TEST");
  await migratePortal(db);
  store = new MongoPortalStore(client, db);
}, 180000);

afterAll(async () => {
  const cached = (globalThis as typeof globalThis & { mapsMongo?: Promise<MongoClient> }).mapsMongo;
  if (cached) await (await cached).close();
  if (client) await client.close();
  if (server) await server.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("migrations are repeatable and records survive reopening the repository", async () => {
  await migratePortal(db);
  const initial = await store.load(alice);
  expect(initial.state.searches).toEqual([]);
  const created = await store.execute(alice, { type: "addSearch", term: "Farmácia", city: "Belém, PA, Brasil" }, initial.version);
  const reopened = await new MongoPortalStore(client, db).load(alice);
  expect(reopened).toEqual(created);
  expect(created.state.searches[0].demo).toBe(false);
  const migration = await db.collection("schemaMigrations").findOne({});
  expect(migration?._id).toBe("portal-v1");
});

test("standalone migration command prepares an external database and is repeatable", async () => {
  const run = promisify(execFile);
  const env = { ...process.env, MONGODB_URI: server.getUri(), MONGODB_DB_NAME: "MAPS_MIGRATION_TEST" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run(process.execPath, ["--experimental-strip-types", resolve("scripts", "migrate-mongo.ts")], { env });
    expect(result.stdout).toContain('"event":"migration_completed"');
    expect(result.stdout).not.toContain(server.getUri());
  }
  const migrated = client.db("MAPS_MIGRATION_TEST");
  expect(await migrated.collection("schemaMigrations").countDocuments()).toBe(1);
  expect((await migrated.collection("portalViews").indexes()).some((index) => index.unique)).toBe(true);
});

test("views are per user while searches are shared; another workspace cannot access IDs", async () => {
  const a = await store.load(alice);
  const b = await store.load(bob);
  expect(b.state.searches).toHaveLength(a.state.searches.length);
  expect(b.state.activeSearchId).toBeNull();
  await store.load(outsider);
  await expect(store.execute(outsider, { type: "openSearch", id: a.state.searches[0].id }, 0)).rejects.toMatchObject({ status: 422 });
  expect((await store.load(outsider)).state.searches).toEqual([]);
});

test("concurrent changes produce one commit and one conflict, with no silent overwrite", async () => {
  const initial = await store.load(alice);
  const changes = await Promise.allSettled([
    store.execute(alice, { type: "addSearch", term: "Concorrente A", city: "Belém" }, initial.version),
    store.execute(bob, { type: "addSearch", term: "Concorrente B", city: "Belém" }, initial.version)
  ]);
  expect(changes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const failure = changes.find((result) => result.status === "rejected");
  expect(failure?.status === "rejected" && failure.reason).toMatchObject({ status: 409 });
  expect((await store.load(alice)).state.searches).toHaveLength(initial.state.searches.length + 1);
});

test("favorite, override, hide and authored comments persist atomically; duplicate command is idempotent", async () => {
  const fixture = createDemoState();
  const { page, mobileView, activeSearchId, openTabs, searchFilter, visibility, favoriteOnly, ...data } = fixture;
  const actor = { ...alice, workspaceId: "fixtures-only" };
  await store.load(actor);
  await db.collection<{ _id: string; data: typeof data }>("portalWorkspaces").updateOne({ _id: actor.workspaceId }, { $set: { data } });
  let state = await store.execute(actor, { type: "openSearch", id: "search-demo" }, 0);
  state = await store.execute(actor, { type: "toggleFavorite", id: "demo-01" }, state.version);
  state = await store.execute(actor, { type: "editPlace", id: "demo-01", phone: "0000", website: "https://example.test" }, state.version);
  state = await store.execute(actor, { type: "toggleHidden", id: "demo-01" }, state.version);
  const command = { type: "addComment", id: "demo-01", text: "Comentário de teste" } as const;
  const commandId = randomUUID();
  const version = state.version;
  state = await store.execute(actor, command, version, commandId);
  const repeated = await store.execute(actor, command, version, commandId);
  expect(repeated).toEqual(state);
  expect(state.state.favorites).toContain("demo-01");
  expect(state.state.overrides["demo-01"].phone).toBe("0000");
  expect(state.state.searches[0].hiddenIds).toContain("demo-01");
  expect(state.state.comments["demo-01"]).toEqual([expect.objectContaining({ text: command.text, authorId: actor.userId, authorName: actor.name })]);
  expect(await db.collection("auditEvents").countDocuments({ workspaceId: actor.workspaceId, action: "addComment" })).toBe(1);
  await expect(store.execute(actor, { ...command, text: "Outro corpo" }, state.version, commandId)).rejects.toMatchObject({ status: 409 });
  await expect(store.execute(outsider, { type: "toggleFavorite", id: "demo-01" }, 0)).rejects.toMatchObject({ status: 422 });
});

test("HTTP API denies anonymous access and CSRF, persists authorized commands and reports blocked collection", async () => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  const actor = vi.spyOn(auth, "currentActor").mockResolvedValue(null);
  expect((await GET(new Request("http://localhost:3000/api/v1/portal"))).status).toBe(401);
  actor.mockResolvedValue(alice);
  expect((await POST(new Request("http://localhost:3000/api/v1/portal", { method: "POST" }))).status).toBe(403);
  const current = await store.load(alice);
  const response = await POST(new Request("http://localhost:3000/api/v1/portal", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ version: current.version, commandId: randomUUID(), command: { type: "addSearch", term: "Busca HTTP", city: "Belém" } })
  }));
  expect(response.status).toBe(200);
  expect((await store.load(alice)).state.searches[0].term).toBe("Busca HTTP");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", "true");
  const blocked = await collect(new Request("http://localhost:3000/api/v1/collection", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}"
  }));
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ code: "COLLECTION_NOT_CONFIGURED" });
  expect((await mongoClient()).db("MAPS_TEST").databaseName).toBe("MAPS_TEST");
});

test("rate limit allows exactly 300 mutations per minute and rejects the next", async () => {
  const actor = { ...alice, userId: "rate-limit-test" };
  const now = Date.now();
  for (let count = 0; count < 300; count++) await consumeMutationLimit(db, actor, now);
  await expect(consumeMutationLimit(db, actor, now)).rejects.toMatchObject({ status: 429 });
  await expect(consumeMutationLimit(db, { ...actor, userId: "other-user" }, now)).resolves.toBeUndefined();
  await expect(consumeMutationLimit(db, actor, now + 60000)).resolves.toBeUndefined();
});

test("Google monthly reservations enforce exact limit across workspaces concurrently and never store provider data", async () => {
  const budget = new GoogleSearchBudget(client, db);
  const scope = randomUUID();
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    budget.reserve(index % 2 ? alice : outsider, randomUUID(), 3, scope)));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
  for (const result of results) {
    if (result.status === "rejected") expect(result.reason).toMatchObject({ status: 429, code: "GOOGLE_MONTHLY_LIMIT" });
  }
  const requestId = randomUUID();
  const otherScope = randomUUID();
  await budget.reserve(alice, requestId, 3, otherScope);
  await expect(budget.reserve(alice, requestId, 3, otherScope)).rejects.toMatchObject({ code: "GOOGLE_REQUEST_ALREADY_USED" });
  await expect(budget.reserve(alice, randomUUID(), 3, scope, new Date("2030-01-01T00:00:00Z"))).resolves.toBeUndefined();
  for (const receipt of await db.collection("googleSearchRequests").find({}).toArray()) {
    expect(Object.keys(receipt).sort()).toEqual(["_id", "createdAt", "userId", "workspaceId"].sort());
  }
});

test("the 5000th allocated request is allowed but the 5001st cannot be reserved", async () => {
  const scope = randomUUID();
  const now = new Date();
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).format(now);
  const id = createHash("sha256").update(`${scope}:${month}`).digest("hex");
  await db.collection<{ _id: string; count: number }>("googleSearchBudgets").insertOne({ _id: id, count: 4999 });
  const budget = new GoogleSearchBudget(client, db);
  await budget.reserve(alice, randomUUID(), 5000, scope, now);
  await expect(budget.reserve(bob, randomUUID(), 5000, scope, now)).rejects.toMatchObject({ code: "GOOGLE_MONTHLY_LIMIT" });
  expect((await db.collection<{ _id: string; count: number }>("googleSearchBudgets").findOne({ _id: id }))?.count).toBe(5000);
});

test("collection endpoint resolves the saved search securely, calls Google once and persists no returned content", async () => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", "true");
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "fixture-key");
  vi.stubEnv("GOOGLE_PLACES_POLICY_ACKNOWLEDGED", "true");
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "2");
  vi.stubEnv("GOOGLE_PLACES_BILLING_SCOPE", randomUUID());
  vi.spyOn(auth, "currentActor").mockResolvedValue(alice);
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    places: [{ id: "fixture-google-result", displayName: { text: "Synthetic response not retained" }, formattedAddress: "Address not retained" }]
  }));
  const saved = await store.load(alice);
  const search = saved.state.searches[0];
  const body = { searchId: search.id, requestId: randomUUID(), confirmed: true };
  const request = (payload: unknown) => new Request("http://localhost:3000/api/v1/collection", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const response = await collect(request(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ places: [{ name: "Synthetic response not retained" }] });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).textQuery).toBe(`${search.term} em ${search.city}`);
  expect(await store.load(alice)).toEqual(saved);
  const repeated = await collect(request(body));
  expect(repeated.status).toBe(409);
  vi.spyOn(auth, "currentActor").mockResolvedValue(outsider);
  expect((await collect(request({ ...body, requestId: randomUUID() }))).status).toBe(404);
  expect(transport).toHaveBeenCalledTimes(1);
  for (const name of ["googleSearchRequests", "googleSearchBudgets", "auditEvents", "portalWorkspaces"]) {
    expect(JSON.stringify(await db.collection(name).find({}).toArray())).not.toContain("Synthetic response not retained");
  }
});
