// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import * as auth from "../src/infrastructure/server/auth";
import { POST } from "../src/app/api/v1/collection/route";
import { createHash } from "node:crypto";
import { googleBudgetPeriod } from "../src/infrastructure/server/google-search-budget";
import { serializeCollectionJob, type CollectionJob } from "../src/infrastructure/server/collection-runner";
import { collectionJobSchema } from "../src/domain/collection-job";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function request(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/v1/collection", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}"
  });
}

test.each([
  [undefined, 409, "COLLECTION_DISABLED"],
  ["false", 409, "COLLECTION_DISABLED"],
  ["true", 409, "COLLECTION_NOT_CONFIGURED"],
  ["TRUE", 503, "COLLECTION_CONFIGURATION_INVALID"],
  ["", 503, "COLLECTION_CONFIGURATION_INVALID"],
  [" false ", 503, "COLLECTION_CONFIGURATION_INVALID"]
])("collection configuration %s is validated only when calling the endpoint", async (value, status, code) => {
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", value);
  vi.spyOn(auth, "currentActor").mockResolvedValue({ userId: "fixture-user", workspaceId: "maps", name: "Fixture" });
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code, error: expect.any(String), requestId: expect.any(String) });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("authentication and origin checks precede collection configuration validation", async () => {
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_COLLECTION_ENABLED", "invalid");
  const actor = vi.spyOn(auth, "currentActor").mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  actor.mockResolvedValue({ userId: "fixture-user", workspaceId: "maps", name: "Fixture" });
  expect((await POST(request("https://invalid.example.test"))).status).toBe(403);
});

test("quota reads and reservations use the original Pacific month and hash across month boundaries", () => {
  const before = googleBudgetPeriod("shared-scope", new Date("2026-03-01T07:59:59Z"));
  const after = googleBudgetPeriod("shared-scope", new Date("2026-03-01T08:00:00Z"));
  expect(before).toEqual({ month: "02/2026", id: createHash("sha256").update("shared-scope:02/2026").digest("hex") });
  expect(after).toEqual({ month: "03/2026", id: createHash("sha256").update("shared-scope:03/2026").digest("hex") });
});

test("shared job serializer preserves the HTTP contract without exposing workspace, actor or query", () => {
  const job: CollectionJob = {
    _id: "job-id", workspaceId: "workspace", userId: "user", actorName: "Actor", searchId: "search",
    term: "Termo", city: "Cidade", status: "done", requestsMade: 2, maxRequestsPerRun: 100,
    importedCount: 40, hasMore: true, collectedSoFar: 40,
    createdAt: new Date("2026-10-30T01:00:00Z"), startedAt: new Date("2026-10-30T01:00:01Z"),
    finishedAt: new Date("2026-10-30T01:00:02Z")
  };
  const serialized = serializeCollectionJob(job);
  expect(collectionJobSchema.parse(serialized)).toEqual(serialized);
  expect(JSON.parse(JSON.stringify(serialized))).toEqual({
    id: "job-id", status: "done", requestsMade: 2, maxRequestsPerRun: 100, importedCount: 40, hasMore: true, collectedSoFar: 40,
    createdAt: "2026-10-30T01:00:00.000Z", startedAt: "2026-10-30T01:00:01.000Z", finishedAt: "2026-10-30T01:00:02.000Z"
  });
  expect(serializeCollectionJob({ ...job, startedAt: undefined, finishedAt: undefined })).toMatchObject({
    startedAt: undefined, finishedAt: undefined
  });
  expect(job.createdAt).toBeInstanceOf(Date);
});
