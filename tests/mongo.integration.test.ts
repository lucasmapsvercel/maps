// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { Collection, MongoClient, type Db } from "mongodb";
import { getRun } from "workflow/api";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoPortalStore } from "../src/infrastructure/server/mongo-portal-store";
import { migratePortal } from "../src/infrastructure/server/mongo-schema";
import { createDemoState } from "../src/infrastructure/demo-state";
import { consumeMutationLimit } from "../src/infrastructure/server/rate-limit";
import * as auth from "../src/infrastructure/server/auth";
import { GET, POST } from "../src/app/api/v1/portal/route";
import { POST as collect } from "../src/app/api/v1/collection/route";
import { POST as runCollection } from "../src/app/api/v1/collection/run/route";
import { mongoClient } from "../src/infrastructure/server/mongo";
import { GoogleSearchBudget } from "../src/infrastructure/server/google-search-budget";
import { LoggedGoogleSearch } from "../src/infrastructure/server/logged-google-search";
import { PortalError } from "../src/application/portal-error";
import { GET as getLogs } from "../src/app/api/v1/collection/logs/route";
import { GET as getLogDetails } from "../src/app/api/v1/collection/logs/[logId]/route";
import { GoogleTextSearchProvider } from "../src/infrastructure/server/google-places-provider";
import type { GoogleSearchDetailsDocument } from "../src/infrastructure/server/logged-google-search";
import { IbgeMunicipalities, ibgeMunicipalities } from "../src/infrastructure/server/ibge-municipalities";
import {
  startCollectionJob, getCollectionJob, getQuotaUsage, prepareCollectionJob, planCollectionJob,
  fetchCollectionPage, importCollectionPage, finishCollectionJob, getCollectionCoverage
} from "../src/infrastructure/server/collection-runner";
import { GET as getCollectionConfig, PUT as putCollectionConfig } from "../src/app/api/v1/collection/config/route";
import { recoverInterruptedCollection } from "../src/infrastructure/server/collection-recovery";
import type { Municipality } from "../src/domain/municipality";
import { neighborhoodPlan } from "../src/infrastructure/server/ibge-neighborhoods";
import { GET as getCollectionPlan } from "../src/app/api/v1/collection/plan/route";

let server: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let store: MongoPortalStore;
const workflowHarness = vi.hoisted(() => ({ enqueue: null as null | ((jobId: string) => Promise<string>), status: "running" }));
vi.mock("workflow/api", () => ({ getRun: vi.fn(() => ({ status: Promise.resolve(workflowHarness.status) })) }));
vi.mock("../src/infrastructure/server/collection-workflow-start", () => ({
  enqueueCollectionWorkflow: (jobId: string) => workflowHarness.enqueue!(jobId)
}));
const workflowTasks = new Set<Promise<void>>();
const alice = { workspaceId: "workspace-a", userId: "google-alice", name: "Alice Test" };
const bob = { ...alice, userId: "google-bob", name: "Bob Test" };
const outsider = { ...bob, workspaceId: "workspace-b" };

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("MAPS_TEST");
  await migratePortal(db);
  store = new MongoPortalStore(client, db);
  workflowHarness.enqueue = async (jobId) => {
    const task = (async () => {
      try {
        await prepareCollectionJob(jobId, db);
        while (true) {
          const plan = await planCollectionJob(jobId, db);
          if (!plan) return;
          if (plan.done) { await finishCollectionJob(jobId, client, db); return; }
          const results = await Promise.allSettled([
            plan.importPage ? importCollectionPage(jobId, plan.importIndex, client, db) : Promise.resolve(),
            plan.fetchPage ? fetchCollectionPage(jobId, plan.requestIndex, "fixture-api-key", client, db) : Promise.resolve()
          ]);
          for (const result of results) if (result.status === "rejected") throw result.reason;
        }
      } catch (error) {
        await finishCollectionJob(jobId, client, db, error instanceof Error ? error.message : "Erro");
      }
    })();
    workflowTasks.add(task);
    void task.then(() => workflowTasks.delete(task));
    return `test-run-${jobId}`;
  };
}, 180000);

afterAll(async () => {
  await Promise.all(workflowTasks);
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

async function pausedCollection(workspaceId: string, municipality?: Municipality, limit = 10) {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  await setRequestLimit(limit);
  const actor = { ...alice, workspaceId };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, {
    type: "addSearch", term: "Durável", city: "Belém, Pará, Brasil", ...(municipality ? { municipality } : {})
  }, initial.version);
  const search = saved.state.searches[0];
  const scope = randomUUID();
  const enqueue = workflowHarness.enqueue;
  workflowHarness.enqueue = async () => "paused-run";
  let id: string;
  try { id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db); }
  finally { workflowHarness.enqueue = enqueue; }
  await prepareCollectionJob(id, db);
  return { id, actor, search, scope };
}

const belem: Municipality = { ibgeCode: "1501402", name: "Belém", stateCode: "PA", stateName: "Pará", country: "Brasil" };

test("all Belem neighborhoods paginate automatically with a shared limit, persisted resume and deduplication", async () => {
  const { id, actor, search, scope } = await pausedCollection("neighborhood-flow", belem, 3);
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "5000");
  const areas = neighborhoodPlan(search).neighborhoods!;
  expect(areas).toHaveLength(71);
  const requests: Array<{ textQuery: string; pageToken?: string; pageSize: number }> = [];
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    requests.push(body);
    return Response.json({
      places: [{ id: "shared-place" }, { id: `unique-${requests.length}` }],
      ...(requests.length === 1 ? { nextPageToken: "first-neighborhood-page2" } : {})
    });
  });
  while (true) {
    const plan = (await planCollectionJob(id, db))!;
    if (plan.done) break;
    await Promise.all([
      plan.fetchPage ? fetchCollectionPage(id, plan.requestIndex, "fixture", client, db) : Promise.resolve(),
      plan.importPage ? importCollectionPage(id, plan.importIndex, client, db) : Promise.resolve()
    ]);
  }
  await finishCollectionJob(id, client, db);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({
    status: "done", requestsMade: 3, importedCount: 4, hasMore: true,
    coverage: { mode: "neighborhoods", total: 71, completed: 2, current: areas[2].name }
  });
  expect(requests.map((request) => request.pageToken)).toEqual([undefined, "first-neighborhood-page2", undefined]);
  expect(requests.map((request) => request.textQuery)).toEqual([
    `Durável em ${areas[0].name}, ${search.city}`, `Durável em ${areas[0].name}, ${search.city}`,
    `Durável em ${areas[1].name}, ${search.city}`
  ]);
  await setRequestLimit(100);
  const resumed = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  await vi.waitFor(async () => expect((await getCollectionJob(resumed, actor.workspaceId, db))?.status).toBe("done"), { timeout: 30000 });
  expect(await getCollectionJob(resumed, actor.workspaceId, db)).toMatchObject({
    status: "done", requestsMade: 69, importedCount: 69, hasMore: false,
    coverage: { mode: "neighborhoods", total: 71, completed: 71 }
  });
  expect(requests.slice(3).map((request) => request.textQuery)).toEqual(
    areas.slice(2).map((area) => `Durável em ${area.name}, ${search.city}`)
  );
  expect(requests.slice(3).every((request) => !request.pageToken)).toBe(true);
  expect(requests.every((request) => request.pageSize === 20)).toBe(true);
  const ids = (await store.load(actor)).state.searches[0].placeIds;
  expect(ids).toHaveLength(73);
  expect(new Set(ids).size).toBe(73);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 72 });
  const cursor = await db.collection("collectionCursors").findOne({ searchId: search.id });
  expect(cursor?.buffer).toEqual([]);
  expect(cursor?.nextPageToken).toBeUndefined();
  expect(cursor?.coverage).not.toHaveProperty("current");
  const log = await db.collection("googleSearchRequests").findOne({ searchId: search.id });
  expect(log?.city).toContain(areas[0].name);
  await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db))
    .rejects.toMatchObject({ code: "COLLECTION_EXHAUSTED" });
  expect(transport).toHaveBeenCalledTimes(72);
}, 40000);

test("a replayed last page advances the neighborhood only once after lost acknowledgement", async () => {
  const { id, actor, search } = await pausedCollection("neighborhood-replay", belem);
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ places: [] }));
  const updateOne = Collection.prototype.updateOne;
  vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (this: Collection, ...args) {
    const result = await updateOne.apply(this, args);
    if (this.collectionName === "collectionCursors" && "$push" in args[1]) throw new Error("Acknowledgement lost");
    return result;
  });
  await expect(fetchCollectionPage(id, 0, "fixture", client, db)).rejects.toThrow("Acknowledgement lost");
  await fetchCollectionPage(id, 0, "fixture", client, db);
  const cursor = await db.collection("collectionCursors").findOne({ searchId: search.id });
  expect(cursor?.coverage).toMatchObject({ completed: 1, total: 71 });
  expect(transport).toHaveBeenCalledTimes(1);
  await finishCollectionJob(id, client, db);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({ hasMore: true });
});

test("a request limit reached inside a neighborhood preserves its token and resumes the same query", async () => {
  const { id, actor, search, scope } = await pausedCollection("neighborhood-token-resume", belem, 1);
  const transport = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ places: [{ id: "first" }], nextPageToken: "same-neighborhood-next" }))
    .mockResolvedValueOnce(Response.json({ places: [{ id: "second" }] }));
  await fetchCollectionPage(id, 0, "fixture", client, db);
  await importCollectionPage(id, 0, client, db);
  expect((await planCollectionJob(id, db))?.done).toBe(true);
  await finishCollectionJob(id, client, db);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({
    requestsMade: 1, hasMore: true, coverage: { completed: 0, current: "Aeroporto" }
  });
  const resumed = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  expect(await waitForJob(resumed, actor.workspaceId)).toMatchObject({
    status: "done", requestsMade: 1, hasMore: true, coverage: { completed: 1, current: "Água Boa" }
  });
  const bodies = transport.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(bodies.map((body) => body.pageToken)).toEqual([undefined, "same-neighborhood-next"]);
  expect(bodies[0].textQuery).toBe(bodies[1].textQuery);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 2 });
});

test("monthly quota is shared between neighborhoods and empty results advance without extra charges", async () => {
  const { id, actor, scope } = await pausedCollection("neighborhood-monthly-quota", belem);
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "1");
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ places: [] }));
  await fetchCollectionPage(id, 0, "fixture", client, db);
  expect(await planCollectionJob(id, db)).toMatchObject({ done: false, fetchPage: true, requestIndex: 1 });
  await expect(fetchCollectionPage(id, 1, "fixture", client, db)).rejects.toMatchObject({ code: "GOOGLE_MONTHLY_LIMIT" });
  await finishCollectionJob(id, client, db, "Cota mensal atingida");
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({
    status: "failed", requestsMade: 1, coverage: { completed: 1, total: 71 }
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 1, remaining: 0 });
});

test("coverage preview is workspace scoped, uses municipal fallback and never calls Google", async () => {
  const { id, actor, search } = await pausedCollection("neighborhood-preview", belem);
  vi.spyOn(auth, "currentActor").mockResolvedValue(actor);
  const transport = vi.spyOn(globalThis, "fetch");
  const preview = new Request(`http://localhost:3000/api/v1/collection/plan?searchId=${search.id}`);
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  expect(await (await getCollectionPlan(preview)).json()).toMatchObject({
    mode: "neighborhoods", total: 71, completed: 0, catalogDate: "2022"
  });
  vi.spyOn(auth, "currentActor").mockResolvedValue({ ...actor, workspaceId: "another-workspace" });
  expect((await getCollectionPlan(preview)).status).toBe(404);
  const missing = await pausedCollection("neighborhood-missing", { ...belem, ibgeCode: "1500131", name: "Abel Figueiredo" });
  expect(await getCollectionCoverage(missing.actor.workspaceId, missing.search.id, db)).toMatchObject({
    mode: "municipality", reason: "catalog_unavailable"
  });
  await db.collection("collectionCursors").updateOne({ searchId: search.id }, { $unset: { coverage: "", neighborhoods: "" } });
  expect(await getCollectionCoverage(actor.workspaceId, search.id, db)).toMatchObject({ mode: "municipality", reason: "legacy_cursor" });
  expect(transport).not.toHaveBeenCalled();
  await finishCollectionJob(id, client, db);
  await finishCollectionJob(missing.id, client, db);
});

test("durable steps replay saved pages and committed imports without repeating Google or counters", async () => {
  const { id, actor, scope } = await pausedCollection("durable-replay");
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    places: [{ id: "durable-place" }], nextPageToken: "durable-next"
  }));
  const updateOne = Collection.prototype.updateOne;
  vi.spyOn(Collection.prototype, "updateOne").mockImplementation(async function (this: Collection, ...args) {
    const result = await updateOne.apply(this, args);
    if (this.collectionName === "collectionCursors" && "$push" in args[1]) throw new Error("Acknowledgement lost");
    return result;
  });
  await expect(fetchCollectionPage(id, 0, "fixture", client, db)).rejects.toThrow("Acknowledgement lost");
  await fetchCollectionPage(id, 0, "fixture", client, db);
  expect(transport).toHaveBeenCalledTimes(1);
  const execute = MongoPortalStore.prototype.execute;
  vi.spyOn(MongoPortalStore.prototype, "execute").mockImplementationOnce(async function (this: MongoPortalStore, ...args) {
    await execute.apply(this, args);
    throw new Error("Commit acknowledgement lost");
  });
  await expect(importCollectionPage(id, 0, client, db)).rejects.toThrow("Commit acknowledgement lost");
  await importCollectionPage(id, 0, client, db);
  expect((await store.load(actor)).state.searches[0].placeIds).toEqual(["durable-place"]);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({ requestsMade: 1, importedPages: 1, collectedSoFar: 1 });
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 1 });
  await finishCollectionJob(id, client, db);
  await finishCollectionJob(id, client, db);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({ status: "done", importedCount: 1, hasMore: true });
});

test("a reserved request without a page checkpoint is not sent again after a worker interruption", async () => {
  const { id, actor, search, scope } = await pausedCollection("durable-uncertain");
  await new GoogleSearchBudget(client, db).reserve(actor, `${id}-p0`, 20, scope, new Date(), {
    actorName: actor.name, searchId: search.id, term: search.term, city: search.city, source: "collection", continuation: false
  }, id);
  const transport = vi.spyOn(globalThis, "fetch");
  await expect(fetchCollectionPage(id, 0, "fixture", client, db)).rejects.toMatchObject({ code: "COLLECTION_RESPONSE_UNCERTAIN" });
  expect(transport).not.toHaveBeenCalled();
  await finishCollectionJob(id, client, db, "Resposta incerta");
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 1 });
  expect(await db.collection("collectionCursors").findOne({ searchId: search.id })).toMatchObject({ blocked: true });
  await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db))
    .rejects.toMatchObject({ code: "COLLECTION_RESPONSE_UNCERTAIN" });
});

test("failed scheduling releases a pending job transactionally without Google calls", async () => {
  const { id, actor, search, scope } = await pausedCollection("durable-enqueue-failure");
  await finishCollectionJob(id, client, db);
  const enqueue = workflowHarness.enqueue;
  const transport = vi.spyOn(globalThis, "fetch");
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  workflowHarness.enqueue = async () => { throw new Error("Queue unavailable"); };
  try {
    await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db))
      .rejects.toMatchObject({ code: "COLLECTION_ENQUEUE_FAILED", status: 503 });
    expect(await db.collection("collectionJobs").countDocuments({ searchId: search.id, status: "failed" })).toBe(1);
    expect(await db.collection("collectionCursors").countDocuments({ searchId: search.id, activeJobId: { $exists: true } })).toBe(0);
    expect(transport).not.toHaveBeenCalled();
    expect(logging).toHaveBeenCalledWith(expect.stringContaining("collection_enqueue_failure"));
  } finally { workflowHarness.enqueue = enqueue; }
});

test.each(["legacy", "running", "failed", "cancelled", "completed"])("stale worker recovery is safe for %s executions", async (state) => {
  const { id, actor, search, scope } = await pausedCollection(`durable-recovery-${state}`);
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ places: [{ id: "recovered-place" }], nextPageToken: "saved-next" }));
  await fetchCollectionPage(id, 0, "fixture", client, db);
  const old = new Date(Date.now() - 20 * 60_000);
  const jobs = db.collection<{ _id: string }>("collectionJobs");
  await jobs.updateOne({ _id: id }, {
    $set: { startedAt: old, updatedAt: old },
    ...(state === "legacy" ? { $unset: { workflowRunId: "", workflowVersion: "" } } : {})
  });
  workflowHarness.status = state;
  const before = (await getCollectionJob(id, actor.workspaceId, db))!;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const after = await recoverInterruptedCollection(before, client, db);
  if (state === "running") {
    expect(after.status).toBe("running");
    expect(warning).not.toHaveBeenCalled();
    await finishCollectionJob(id, client, db, "Encerrando teste");
  } else {
    expect(after.status).toBe("failed");
    const cursor = await db.collection("collectionCursors").findOne({ searchId: search.id });
    expect(cursor).toMatchObject({ blocked: true, buffer: [{ id: "recovered-place", name: expect.any(String), address: expect.any(String), attributions: [] }] });
    expect(cursor?.activeJobId).toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("collection_interrupted_recovered"));
    if (state !== "legacy") expect(getRun).toHaveBeenCalledWith("paused-run");
  }
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 1 });
});

test("recovery ignores fresh jobs and does not overwrite a concurrent heartbeat", async () => {
  const { id, actor } = await pausedCollection("durable-recovery-heartbeat");
  const fresh = (await getCollectionJob(id, actor.workspaceId, db))!;
  const status = vi.mocked(getRun);
  status.mockClear();
  expect(await recoverInterruptedCollection(fresh, client, db)).toBe(fresh);
  expect(status).not.toHaveBeenCalled();
  const old = new Date(Date.now() - 20 * 60_000);
  await db.collection<{ _id: string }>("collectionJobs").updateOne({ _id: id }, { $set: { updatedAt: old } });
  const stale = (await getCollectionJob(id, actor.workspaceId, db))!;
  workflowHarness.status = "failed";
  await db.collection<{ _id: string }>("collectionJobs").updateOne({ _id: id }, { $set: { updatedAt: new Date() } });
  expect((await recoverInterruptedCollection(stale, client, db)).status).toBe("running");
  expect(await db.collection("collectionCursors").findOne({ activeJobId: id })).not.toHaveProperty("blocked");
  await finishCollectionJob(id, client, db);
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
  const municipality = { ibgeCode: "1501402", name: "Belém", stateCode: "PA" as const, stateName: "Pará", country: "Brasil" as const };
  vi.spyOn(ibgeMunicipalities, "list").mockResolvedValue([municipality]);
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
    body: JSON.stringify({ version: current.version, commandId: randomUUID(), command: {
      type: "addSearch", term: "Busca HTTP", city: "Texto arbitrário", municipality: { ...municipality, name: "Nome adulterado" }
    } })
  }));
  expect(response.status).toBe(200);
  expect((await store.load(alice)).state.searches[0].term).toBe("Busca HTTP");
  expect((await store.load(alice)).state.searches[0]).toMatchObject({
    city: "Belém, Pará, Brasil", municipality
  });
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
  const receiptIds = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  receiptIds.push(await budget.reserve(alice, requestId, 3, otherScope));
  await expect(budget.reserve(alice, requestId, 3, otherScope)).rejects.toMatchObject({ code: "GOOGLE_REQUEST_ALREADY_USED" });
  receiptIds.push(await budget.reserve(alice, randomUUID(), 3, scope, new Date("2030-01-01T00:00:00Z")));
  for (const receipt of await db.collection<{ _id: string }>("googleSearchRequests").find({ _id: { $in: receiptIds } }).toArray()) {
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

test("collection endpoint resolves the saved search securely, calls Google once and keeps returned content out of permanent receipts", async () => {
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

test.each([
  { scenario: "provider-ends-at-three", pages: 3, runLimit: 50, monthlyLimit: 5000, continuation: false, status: "done", hasMore: false },
  { scenario: "provider-allows-four", pages: 4, runLimit: 50, monthlyLimit: 5000, continuation: false, status: "done", hasMore: false },
  { scenario: "configured-three", pages: 3, runLimit: 3, monthlyLimit: 5000, continuation: true, status: "done", hasMore: true },
  { scenario: "monthly-three", pages: 3, runLimit: 50, monthlyLimit: 3, continuation: true, status: "failed", hasMore: undefined }
])("portal pagination investigation: $scenario", async ({ scenario, pages, runLimit, monthlyLimit, continuation, status, hasMore }) => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", "true");
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "fixture-key");
  vi.stubEnv("GOOGLE_PLACES_POLICY_ACKNOWLEDGED", "true");
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", String(monthlyLimit));
  const scope = randomUUID();
  vi.stubEnv("GOOGLE_PLACES_BILLING_SCOPE", scope);
  await setRequestLimit(runLimit);
  const actor = { ...alice, workspaceId: scenario };
  vi.spyOn(auth, "currentActor").mockResolvedValue(actor);
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Teste de paginação", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  let page = 0;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ pageSize: 20, textQuery: "Teste de paginação em Belém" });
    expect(body.pageToken).toBe(page === 0 ? undefined : `investigation-page-${page}`);
    const current = page++;
    expect(page).toBeLessThanOrEqual(pages);
    return Response.json({
      places: Array.from({ length: 20 }, (_, index) => ({ id: `investigation-${current}-${index}` })),
      ...(page < pages || continuation ? { nextPageToken: `investigation-page-${page}` } : {})
    });
  });
  const response = await runCollection(new Request("http://localhost:3000/api/v1/collection/run", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ searchId: search.id, confirmed: true })
  }));
  expect(response.status).toBe(202);
  const { jobId } = await response.json();
  const job = await waitForJob(jobId, actor.workspaceId);
  expect(job).toMatchObject({ status, requestsMade: pages, maxRequestsPerRun: runLimit, collectedSoFar: pages * 20 });
  if (status === "done") expect(job).toMatchObject({ importedCount: pages * 20, hasMore });
  else expect(job.error).toMatch(/limite mensal/i);
  expect(transport).toHaveBeenCalledTimes(pages);
  expect((await store.load(actor)).state.searches[0].placeIds).toHaveLength(pages * 20);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: pages, remaining: monthlyLimit - pages });
  const cursor = await db.collection("collectionCursors").findOne({ searchId: search.id, workspaceId: actor.workspaceId });
  expect(cursor).toMatchObject({ buffer: [], exhausted: !continuation });
  expect(cursor?.nextPageToken).toBe(continuation ? `investigation-page-${pages}` : undefined);
  const logs = await db.collection("googleSearchRequests").find({ workspaceId: actor.workspaceId }).toArray();
  expect(logs).toHaveLength(pages);
  expect(logs.every((log) => log.status === "success" && log.resultCount === 20)).toBe(true);
  if (!continuation) {
    const restart = await runCollection(new Request("http://localhost:3000/api/v1/collection/run", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ searchId: search.id, confirmed: true })
    }));
    expect(restart.status).toBe(409);
    expect(await restart.json()).toMatchObject({ code: "COLLECTION_EXHAUSTED" });
    expect(transport).toHaveBeenCalledTimes(pages);
  }
});

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

test.each(["import-first", "response-first", "import-failure", "failure-in-flight"])(
  "next Google request overlaps a slow import without losing pages (%s)", async (order) => {
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
    const actor = { ...alice, workspaceId: `pipeline-${order}` };
    const initial = await store.load(actor);
    const saved = await store.execute(actor, { type: "addSearch", term: "Fluxo", city: "Belém" }, initial.version);
    const search = saved.state.searches[0];
    let releaseImport!: () => void;
    const importing = new Promise<void>((resolve) => { releaseImport = resolve; });
    const execute = MongoPortalStore.prototype.execute;
    const imports = vi.spyOn(MongoPortalStore.prototype, "execute").mockImplementationOnce(async function (
      this: MongoPortalStore, ...args: Parameters<MongoPortalStore["execute"]>
    ) {
      await importing;
      if (order === "import-failure" || order === "failure-in-flight") throw new Error("Importação indisponível");
      return execute.apply(this, args);
    });
    const page = (start: number, nextPageToken?: string) => Response.json({
      places: Array.from({ length: 20 }, (_, index) => ({ id: `pipeline-${start + index}` })), nextPageToken
    });
    let releaseResponse!: (response: Response) => void;
    const transport = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(page(0, "next-page"))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseResponse = resolve; }));
    const scope = randomUUID();
    const first = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
    try {
      await vi.waitFor(() => {
        expect(imports).toHaveBeenCalledTimes(1);
        expect(transport).toHaveBeenCalledTimes(2);
      });
      expect((await store.load(actor)).state.searches[0].placeIds).toHaveLength(0);
      expect(JSON.parse(String(transport.mock.calls[1][1]?.body)).pageToken).toBe("next-page");
      if (order === "failure-in-flight") {
        releaseImport();
        await expect(imports.mock.results[0].value).rejects.toThrow("Importação indisponível");
        expect((await getCollectionJob(first, actor.workspaceId, db))?.status).toBe("running");
        await expect(startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db))
          .rejects.toMatchObject({ code: "COLLECTION_ALREADY_RUNNING" });
        releaseResponse(page(20));
      } else if (order === "import-first") {
        releaseImport();
        await vi.waitFor(async () => expect((await getCollectionJob(first, actor.workspaceId, db))?.collectedSoFar).toBe(20));
        expect((await getCollectionJob(first, actor.workspaceId, db))?.status).toBe("running");
        releaseResponse(page(20));
      } else {
        releaseResponse(page(20));
        await vi.waitFor(async () => {
          const cursor = await db.collection("collectionCursors").findOne({ searchId: search.id });
          expect(cursor?.buffer).toHaveLength(40);
          expect(cursor?.exhausted).toBe(true);
        });
        releaseImport();
      }
      const job = await waitForJob(first, actor.workspaceId);
      const failed = order === "import-failure" || order === "failure-in-flight";
      expect(job).toMatchObject({ status: failed ? "failed" : "done", requestsMade: 2 });
      imports.mockRestore();
      if (failed) {
        const retry = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
        expect(await waitForJob(retry, actor.workspaceId)).toMatchObject({
          status: "done", requestsMade: 0, importedCount: 40, hasMore: false
        });
      } else {
        expect(job).toMatchObject({ importedCount: 40, collectedSoFar: 40, hasMore: false });
      }
      expect(transport).toHaveBeenCalledTimes(2);
      const ids = (await store.load(actor)).state.searches[0].placeIds;
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
      expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 2 });
      expect((await db.collection("collectionCursors").findOne({ searchId: search.id }))?.buffer).toEqual([]);
    } finally {
      releaseImport();
      releaseResponse?.(page(20));
    }
  }
);

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

test("deleting a search persists across users, cleans all tabs and cursor, preserves annotations and audit history", async () => {
  const actor = { ...alice, workspaceId: "delete-search" };
  const colleague = { ...actor, userId: bob.userId };
  let current = await store.load(actor);
  current = await store.execute(actor, { type: "addSearch", term: "Preservada", city: "Belém" }, current.version);
  const remainingId = current.state.searches[0].id;
  current = await store.execute(actor, { type: "addSearch", term: "Excluir", city: "Belém" }, current.version);
  const id = current.state.searches[0].id;
  current = await store.execute(actor, {
    type: "importPlaces", searchId: id, places: [{ id: "kept-place", name: "Mantido", address: "Rua", category: "" }]
  }, current.version);
  current = await store.execute(actor, { type: "toggleFavorite", id: "kept-place" }, current.version);
  current = await store.execute(actor, { type: "addComment", id: "kept-place", text: "Manter anotação" }, current.version);
  current = await store.execute(actor, { type: "editPlace", id: "kept-place", phone: "0000", website: "" }, current.version);
  await store.load(colleague);
  current = await store.execute(colleague, { type: "openSearch", id: remainingId }, current.version);
  current = await store.execute(colleague, { type: "openSearch", id }, current.version);
  await db.collection("collectionCursors").insertOne({ workspaceId: actor.workspaceId, searchId: id, buffer: [{ id: "unused" }] });
  const otherWorkspace = { ...actor, workspaceId: "delete-search-outsider" };
  const foreign = await store.load(otherWorkspace);
  await expect(store.execute(otherWorkspace, { type: "deleteSearch", id }, foreign.version)).rejects.toMatchObject({ status: 422 });
  const commandId = randomUUID();
  const deleted = await store.execute(actor, { type: "deleteSearch", id }, current.version, commandId);
  expect(deleted.state.searches.map((search) => search.id)).toEqual([remainingId]);
  expect(deleted.state.openTabs).toEqual([remainingId]);
  expect(deleted.state.activeSearchId).toBe(remainingId);
  expect(deleted.state.places).toEqual(current.state.places);
  expect(deleted.state.favorites).toEqual(["kept-place"]);
  expect(deleted.state.comments).toEqual(current.state.comments);
  expect(deleted.state.overrides).toEqual(current.state.overrides);
  expect((await store.load(colleague)).state).toMatchObject({ activeSearchId: remainingId, openTabs: [remainingId] });
  expect(await db.collection("collectionCursors").countDocuments({ workspaceId: actor.workspaceId, searchId: id })).toBe(0);
  expect(await store.execute(actor, { type: "deleteSearch", id }, current.version, commandId)).toEqual(deleted);
  expect(await db.collection("auditEvents").countDocuments({ workspaceId: actor.workspaceId, action: "deleteSearch", entityId: id })).toBe(1);
  await expect(startCollectionJob(actor, id, "Excluir", "Belém", "fixture", randomUUID(), client, db)).rejects.toMatchObject({ code: "SEARCH_NOT_FOUND" });
  const last = await store.execute(actor, { type: "deleteSearch", id: remainingId }, deleted.version);
  expect(last.state.activeSearchId).toBeNull();
  expect((await store.load(colleague)).state).toMatchObject({ searches: [], activeSearchId: null, openTabs: [] });
});

test("deletion cannot race a running collection and preserves its monthly usage and logs after completion", async () => {
  vi.stubEnv("GOOGLE_PLACES_MONTHLY_LIMIT", "20");
  await setRequestLimit(1);
  const actor = { ...alice, workspaceId: "delete-running-search" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Em coleta", city: "Belém" }, initial.version);
  const search = saved.state.searches[0];
  let release!: (response: Response) => void;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const scope = randomUUID();
  const id = await startCollectionJob(actor, search.id, search.term, search.city, "fixture", scope, client, db);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  await expect(store.execute(actor, { type: "deleteSearch", id: search.id }, saved.version)).rejects.toMatchObject({ code: "COLLECTION_ALREADY_RUNNING" });
  release(Response.json({ places: [] }));
  await waitForJob(id, actor.workspaceId);
  const current = await store.load(actor);
  await store.execute(actor, { type: "deleteSearch", id: search.id }, current.version);
  expect(await getQuotaUsage(scope, db)).toMatchObject({ used: 1 });
  expect(await db.collection("googleSearchRequests").countDocuments({ workspaceId: actor.workspaceId, searchId: search.id })).toBe(1);
  expect(await getCollectionJob(id, actor.workspaceId, db)).toMatchObject({ status: "done" });
});

test("navigation and filters accept stale commercial versions while imports preserve the current user page", async () => {
  const actor = { ...alice, workspaceId: "navigation-during-collection" };
  const initial = await store.load(actor);
  const saved = await store.execute(actor, { type: "addSearch", term: "Navegação", city: "Belém" }, initial.version);
  const searchId = saved.state.searches[0].id;
  const imported = await store.execute(actor, {
    type: "importPlaces", searchId, places: [{ id: "navigation-place", name: "Novo", address: "Rua", category: "" }]
  }, saved.version);
  const settings = await store.execute(actor, { type: "navigate", page: "settings" }, saved.version);
  expect(settings.version).toBe(imported.version);
  expect(settings.state.page).toBe("settings");
  const next = await store.execute(actor, {
    type: "importPlaces", searchId, places: [{ id: "navigation-place-2", name: "Outro", address: "Rua", category: "" }]
  }, imported.version);
  expect((await store.load(actor)).state.page).toBe("settings");
  const filtered = await store.execute(actor, { type: "setFilter", filter: { name: "searchFilter", value: "Novo" } }, saved.version);
  expect(filtered.version).toBe(next.version);
  expect(filtered.state.page).toBe("settings");
  expect(filtered.state.searchFilter).toBe("Novo");
  await expect(store.execute(actor, { type: "toggleFavorite", id: "navigation-place" }, saved.version))
    .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});

test("Google request/response details persist for 30 days, isolate workspaces, and expire without removing receipts", async () => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  const actor = { ...alice, workspaceId: "google-details" };
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    places: [{ id: "details-place", displayName: { text: "Empresa do response" }, websiteUri: "https://example.test" }],
    nextPageToken: "private-page-token"
  })).mockResolvedValueOnce(Response.json({
    error: { code: 403, message: "Invalid private-api-key", status: "PERMISSION_DENIED" }
  }, { status: 403 }));
  const logged = new LoggedGoogleSearch(client, db, new GoogleTextSearchProvider("private-api-key", transport));
  const request = {
    requestId: randomUUID(), billingScope: randomUUID(), limit: 5, searchId: "details-search",
    term: "Farmácia", city: "Belém", source: "direct" as const, pageToken: "private-input-token"
  };
  const started = Date.now();
  await logged.search(actor, request);
  const detailsCollection = db.collection<GoogleSearchDetailsDocument>("googleSearchDetails");
  const details = await detailsCollection.findOne({ workspaceId: actor.workspaceId });
  expect(details).not.toBeNull();
  expect(details!.expiresAt.getTime()).toBeGreaterThanOrEqual(started + 30 * 86400_000);
  expect(details!.expiresAt.getTime()).toBeLessThan(Date.now() + 30 * 86400_000 + 1000);
  expect(details!.response).toMatchObject({ httpStatus: 200, body: { places: [{ id: "details-place", displayName: { text: "Empresa do response" } }] } });
  expect(JSON.stringify(details)).not.toContain("private-api-key");
  expect(JSON.stringify(details)).not.toContain("private-page-token");
  expect(JSON.stringify(details)).not.toContain("private-input-token");
  const current = vi.spyOn(auth, "currentActor").mockResolvedValue(null);
  const read = () => getLogDetails(new Request("http://localhost:3000/api/v1/collection/logs/id"),
    { params: Promise.resolve({ logId: details!._id }) });
  expect((await read()).status).toBe(401);
  current.mockResolvedValue(outsider);
  expect((await read()).status).toBe(404);
  current.mockResolvedValue(actor);
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.request.body).toMatchObject({ textQuery: "Farmácia em Belém", pageToken: "[REDACTED]" });
  expect(body).not.toHaveProperty("workspaceId");
  expect(body).not.toHaveProperty("_id");
  await expect(logged.search(actor, { ...request, requestId: randomUUID() })).rejects.toMatchObject({ code: "GOOGLE_REQUEST_FAILED" });
  const failed = await detailsCollection.findOne({ workspaceId: actor.workspaceId, "response.httpStatus": 403 });
  expect(failed?.response?.body).toMatchObject({ error: { status: "PERMISSION_DENIED" } });
  expect(JSON.stringify(failed)).not.toContain("private-api-key");
  await detailsCollection.updateOne({ _id: details!._id }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  expect((await read()).status).toBe(404);
  expect(await db.collection("googleSearchRequests").countDocuments({ workspaceId: actor.workspaceId })).toBe(2);
  expect((await detailsCollection.indexes()).some((index) => index.expireAfterSeconds === 0)).toBe(true);
});

test("new search HTTP API requires an IBGE selection and rejects unknown municipality codes", async () => {
  vi.stubEnv("MONGODB_URI", server.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "MAPS_TEST");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  const actor = { ...alice, workspaceId: "municipality-validation" };
  vi.spyOn(auth, "currentActor").mockResolvedValue(actor);
  const municipality = { ibgeCode: "1501402", name: "Belém", stateCode: "PA" as const, stateName: "Pará", country: "Brasil" as const };
  const offlineCatalog = new IbgeMunicipalities(vi.fn().mockRejectedValue(new Error("IBGE offline")));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const catalog = vi.spyOn(ibgeMunicipalities, "list").mockImplementation(() => offlineCatalog.list());
  const initial = await store.load(actor);
  const send = (command: unknown) => POST(new Request("http://localhost:3000/api/v1/portal", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ version: initial.version, commandId: randomUUID(), command })
  }));
  const base = { type: "addSearch", term: "Clínica", city: "Belém" };
  const missing = await send(base);
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ code: "MUNICIPALITY_REQUIRED" });
  expect(catalog).not.toHaveBeenCalled();
  const invalid = await send({ ...base, municipality: { ...municipality, ibgeCode: "9999999" } });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: "MUNICIPALITY_NOT_FOUND" });
  expect((await store.load(actor)).state.searches).toEqual([]);
  const valid = await send({ ...base, municipality: { ...municipality, name: "Nome adulterado" }, city: "Cidade arbitrária" });
  expect(valid.status).toBe(200);
  expect((await valid.json()).state.searches[0]).toMatchObject({ municipality, city: "Belém, Pará, Brasil" });
  expect((await store.load(actor)).state.searches[0].municipality).toEqual(municipality);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('"event":"ibge_catalog_backup"'));
});
