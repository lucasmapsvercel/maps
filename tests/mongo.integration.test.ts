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
import { LoggedGoogleSearch } from "../src/infrastructure/server/logged-google-search";
import { PortalError } from "../src/application/portal-error";
import { GET as getLogs } from "../src/app/api/v1/collection/logs/route";
import { startCollectionJob, getCollectionJob, getQuotaUsage } from "../src/infrastructure/server/collection-runner";
import { GET as getCollectionConfig, PUT as putCollectionConfig } from "../src/app/api/v1/collection/config/route";

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

async function setRequestLimit(maxRequestsPerRun: number) {
  await db.collection<{ _id: string; maxRequestsPerRun: number }>("collectionConfig")
    .updateOne({ _id: "global" }, { $set: { maxRequestsPerRun } }, { upsert: true });
}

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
  await expect(budget.reserve(alice, randomUUID(), 3, scope, new Date("2030-01-01T00:00:00Z"))).resolves.toEqual(expect.any(String));
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
  const receipt = await db.collection("googleSearchRequests").findOne({ searchId: search.id, source: "direct" });
  expect(receipt).toMatchObject({
    actorName: alice.name, term: search.term, city: search.city,
    status: "success", resultCount: 1, durationMs: expect.any(Number)
  });
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

test("Google logs are reserved before transport, retain sanitized failures and reject duplicate or over-budget calls", async () => {
  const actor = { ...alice, workspaceId: "logs-failures" };
  const request = {
    requestId: randomUUID(), billingScope: randomUUID(), limit: 1,
    searchId: "log-search", term: "Teste", city: "Belém", source: "direct" as const
  };
  const provider = { search: vi.fn(async () => {
    expect(await db.collection("googleSearchRequests").findOne({ workspaceId: actor.workspaceId }))
      .toMatchObject({ status: "pending", term: "Teste" });
    throw new PortalError(502, "GOOGLE_CONNECTION_FAILED", "Private response fixture-secret");
  }) };
  const logged = new LoggedGoogleSearch(client, db, provider);
  await expect(logged.search(actor, request)).rejects.toMatchObject({ code: "GOOGLE_CONNECTION_FAILED" });
  const receipts = await db.collection("googleSearchRequests").find({ workspaceId: actor.workspaceId }).toArray();
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ status: "failed", errorCode: "GOOGLE_CONNECTION_FAILED", durationMs: expect.any(Number) });
  expect(JSON.stringify(receipts)).not.toContain("fixture-secret");
  expect(receipts[0]).not.toHaveProperty("resultCount");
  await expect(logged.search(actor, request)).rejects.toMatchObject({ code: "GOOGLE_REQUEST_ALREADY_USED" });
  await expect(logged.search(actor, { ...request, requestId: randomUUID() })).rejects.toMatchObject({ code: "GOOGLE_MONTHLY_LIMIT" });
  expect(provider.search).toHaveBeenCalledTimes(1);
  expect(await db.collection("googleSearchRequests").countDocuments({ workspaceId: actor.workspaceId })).toBe(1);
});

test("logs endpoint requires login, isolates workspaces, omits legacy receipts and returns only the latest 100 without secrets", async () => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", "false");
  const actor = { ...alice, workspaceId: "logs-history" };
  const other = { ...alice, workspaceId: "logs-other" };
  const budget = new GoogleSearchBudget(client, db);
  await budget.reserve(actor, randomUUID(), 1, randomUUID());
  const metadata = {
    actorName: actor.name, searchId: "search-log", term: "Teste", city: "Belém",
    source: "direct" as const, continuation: false
  };
  for (let index = 0; index < 101; index++) {
    await budget.reserve(actor, randomUUID(), 101, "logs-history-scope",
      new Date(Date.UTC(2026, 9, 1, 0, index)), { ...metadata, term: `Consulta ${index}` });
  }
  await budget.reserve(other, randomUUID(), 1, randomUUID(), new Date(), { ...metadata, term: "Outro workspace" });
  const current = vi.spyOn(auth, "currentActor").mockResolvedValue(null);
  const request = () => new Request("http://localhost:3000/api/v1/collection/logs");
  expect((await getLogs(request())).status).toBe(401);
  current.mockResolvedValue(actor);
  const response = await getLogs(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.logs).toHaveLength(100);
  expect(body.logs[0].term).toBe("Consulta 100");
  expect(body.logs[99].term).toBe("Consulta 1");
  expect(body.logs[0]).not.toHaveProperty("userId");
  expect(body.logs[0]).not.toHaveProperty("workspaceId");
  expect(JSON.stringify(body)).not.toContain("Outro workspace");
});

test("background collection records each Google page, without storing tokens or returned places in logs", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "5");
  const actor = { ...alice, workspaceId: "logs-job" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Coleta teste", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  const transport = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({
      places: [{ id: "job-place", displayName: { text: "Synthetic company" } }], nextPageToken: "private-page-token"
    }))
    .mockResolvedValueOnce(Response.json({ places: [] }));
  const id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture-api-key", randomUUID(), client, db);
  await vi.waitFor(async () => expect((await getCollectionJob(id, actor.workspaceId, db))?.status).toBe("done"), { timeout: 10000 });
  expect(transport).toHaveBeenCalledTimes(2);
  const logs = await db.collection("googleSearchRequests").find({ workspaceId: actor.workspaceId }).sort({ createdAt: 1 }).toArray();
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({ source: "collection", status: "success", resultCount: 1, continuation: false });
  expect(logs[1]).toMatchObject({ source: "collection", status: "success", resultCount: 0, continuation: true });
  for (const privateValue of ["private-page-token", "fixture-api-key", "Synthetic company", "job-place"]) {
    expect(JSON.stringify(logs)).not.toContain(privateValue);
  }
});

async function waitForJob(id: string, workspaceId: string) {
  await vi.waitFor(async () => {
    const job = await getCollectionJob(id, workspaceId, db);
    expect(["done", "failed"]).toContain(job?.status);
    expect(await db.collection("collectionCursors").countDocuments({ activeJobId: id })).toBe(0);
  }, { timeout: 10000 });
  return (await getCollectionJob(id, workspaceId, db))!;
}

test("each execution allows one maximum-size page and continues at the next page, consuming only actual monthly requests", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  await setRequestLimit(1);
  const actor = { ...alice, workspaceId: "incremental-requests" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Lotes", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  const page = (start: number, count: number, nextPageToken?: string) => Response.json({
    places: Array.from({ length: count }, (_, index) => ({ id: `place-${start + index}` })), nextPageToken
  });
  const transport = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(page(0, 20, "next-20"))
    .mockResolvedValueOnce(page(20, 20, "next-40"))
    .mockResolvedValueOnce(page(40, 15));
  const scope = randomUUID();
  for (const [index, count] of [20, 20, 15].entries()) {
    const id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
    const job = await waitForJob(id, actor.workspaceId);
    expect(job).toMatchObject({ status: "done", importedCount: count, hasMore: index < 2, requestsMade: 1, maxRequestsPerRun: 1 });
    expect((await store.load(actor)).state.searches[0].placeIds).toHaveLength(Math.min(55, (index + 1) * 20));
    expect(await getQuotaUsage(scope, db)).toMatchObject({ used: index + 1, remaining: 19 - index, maxRequestsPerRun: 1, resultsPerRequest: 20 });
  }
  expect(transport).toHaveBeenCalledTimes(3);
  const requests = transport.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(requests.map((request) => request.pageToken)).toEqual([undefined, "next-20", "next-40"]);
  expect(requests.map((request) => request.pageSize)).toEqual([20, 20, 20]);
  await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db))
    .rejects.toMatchObject({ code: "COLLECTION_EXHAUSTED" });
  expect(transport).toHaveBeenCalledTimes(3);
});

test("failed import retries the saved page without another Google call and overlapping jobs are blocked", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  await setRequestLimit(100);
  const actor = { ...alice, workspaceId: "incremental-failure" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Retomar", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  let release!: (response: Response) => void;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const execute = vi.spyOn(MongoPortalStore.prototype, "execute").mockRejectedValueOnce(new Error("Importação indisponível"));
  const scope = randomUUID();
  const first = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db))
    .rejects.toMatchObject({ code: "COLLECTION_ALREADY_RUNNING" });
  release(Response.json({ places: [{ id: "saved-page-place" }] }));
  expect(await waitForJob(first, actor.workspaceId)).toMatchObject({ status: "failed", requestsMade: 1 });
  execute.mockRestore();
  const retry = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  expect(await waitForJob(retry, actor.workspaceId)).toMatchObject({ status: "done", importedCount: 1, hasMore: false, requestsMade: 0 });
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await store.load(actor)).state.searches[0].placeIds).toEqual(["saved-page-place"]);
});

test("duplicate Place IDs do not count toward the batch and legacy searches cannot silently restart", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  const actor = { ...alice, workspaceId: "incremental-duplicates" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Duplicados", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  const transport = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ places: [{ id: "a" }, { id: "a" }], nextPageToken: "page2" }))
    .mockResolvedValueOnce(Response.json({ places: [{ id: "a" }, { id: "b" }] }));
  const id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", randomUUID(), client, db);
  expect(await waitForJob(id, actor.workspaceId)).toMatchObject({ status: "done", importedCount: 2, hasMore: false });
  expect((await store.load(actor)).state.searches[0].placeIds).toEqual(["a", "b"]);
  await db.collection("collectionCursors").deleteOne({ workspaceId: actor.workspaceId });
  await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", randomUUID(), client, db))
    .rejects.toMatchObject({ code: "COLLECTION_CURSOR_UNAVAILABLE" });
  expect(transport).toHaveBeenCalledTimes(2);
});

test("a failed continuation preserves the token and imported progress instead of restarting the first page", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  const actor = { ...alice, workspaceId: "incremental-transport-failure" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Falha temporária", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  const transport = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({
      places: Array.from({ length: 20 }, (_, index) => ({ id: `failure-place-${index}` })),
      nextPageToken: "continue-after-20"
    }))
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(Response.json({ places: [{ id: "failure-place-20" }] }));
  const scope = randomUUID();
  const first = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  expect(await waitForJob(first, actor.workspaceId)).toMatchObject({ status: "failed", collectedSoFar: 20, requestsMade: 2 });
  const retry = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  expect(await waitForJob(retry, actor.workspaceId)).toMatchObject({ status: "done", importedCount: 1, hasMore: false, requestsMade: 1 });
  expect((await store.load(actor)).state.searches[0].placeIds).toHaveLength(21);
  expect(transport.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).pageToken))
    .toEqual([undefined, "continue-after-20", "continue-after-20"]);
});

test("simultaneous initial requests claim only one collection cursor", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  const actor = { ...alice, workspaceId: "incremental-race" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Concorrência", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  let release!: (response: Response) => void;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const scope = randomUUID();
  const results = await Promise.allSettled(Array.from({ length: 2 }, () =>
    startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db)));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "COLLECTION_ALREADY_RUNNING" });
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  release(Response.json({ places: [] }));
  for (const result of results) {
    if (result.status === "fulfilled") expect(await waitForJob(result.value, actor.workspaceId)).toMatchObject({ status: "done", hasMore: false });
  }
});

test("request-based config defaults to 100 without reinterpreting legacy result limits and validates the 5000 ceiling", async () => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", "true");
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "fixture-key");
  vi.stubEnv("GOOGLE_PLACES_POLICY_ACKNOWLEDGED", "true");
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "5000");
  vi.stubEnv("GOOGLE_PLACES_BILLING_SCOPE", randomUUID());
  vi.spyOn(auth, "currentActor").mockResolvedValue(alice);
  await db.collection<{ _id: string; maxResultsPerSearch: number }>("collectionConfig")
    .replaceOne({ _id: "global" }, { maxResultsPerSearch: 25 }, { upsert: true });
  expect(await (await getCollectionConfig(new Request("http://localhost:3000/api/v1/collection/config"))).json())
    .toEqual({ maxRequestsPerRun: 100 });
  const put = (body: unknown) => putCollectionConfig(new Request("http://localhost:3000/api/v1/collection/config", {
    method: "PUT", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body)
  }));
  for (const limit of [0, 5001, 1.5]) expect((await put({ maxRequestsPerRun: limit })).status).toBe(400);
  expect((await put({ maxResultsPerSearch: 100 })).status).toBe(400);
  expect(await (await put({ maxRequestsPerRun: 5000 })).json()).toEqual({ maxRequestsPerRun: 5000 });
  expect(await db.collection<{ _id: string }>("collectionConfig").findOne({ _id: "global" })).not.toHaveProperty("maxResultsPerSearch");
});

test("a configured 100-request execution never makes a 101st call and charges 100 of the monthly 5000", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "5000");
  await setRequestLimit(100);
  const actor = { ...alice, workspaceId: "exact-100-requests" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Limite exato", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  let page = 0;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    expect(request.pageSize).toBe(20);
    expect(request.pageToken).toBe(page === 0 ? undefined : `token-${page}`);
    const current = page++;
    return Response.json({
      places: Array.from({ length: 20 }, (_, index) => ({ id: `page-${current}-place-${index}` })),
      nextPageToken: `token-${page}`
    });
  });
  const scope = randomUUID();
  const id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  await vi.waitFor(async () => expect((await getCollectionJob(id, actor.workspaceId, db))?.status).toBe("done"), { timeout: 30000 });
  await waitForJob(id, actor.workspaceId);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({
    status: "done", requestsMade: 100, maxRequestsPerRun: 100, importedCount: 2000, hasMore: true
  });
  expect(transport).toHaveBeenCalledTimes(100);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 100, limit: 5000, remaining: 4900 });
  expect((await store.load(actor)).state.searches[0].placeIds).toHaveLength(2000);
}, 40000);

test("a smaller remaining monthly quota blocks further calls without charging the refused request", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "2");
  await setRequestLimit(100);
  const actor = { ...alice, workspaceId: "monthly-stop" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Cota restante", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  let page = 0;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ places: [{ id: `monthly-${page++}` }], nextPageToken: `monthly-token-${page}` }));
  const scope = randomUUID();
  const id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  expect(await waitForJob(id, actor.workspaceId)).toMatchObject({ status: "failed", requestsMade: 2, collectedSoFar: 2 });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 2, remaining: 0 });
});
