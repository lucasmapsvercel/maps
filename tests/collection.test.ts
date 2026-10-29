// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import * as auth from "../src/infrastructure/server/auth";
import { POST } from "../src/app/api/v1/collection/route";

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
