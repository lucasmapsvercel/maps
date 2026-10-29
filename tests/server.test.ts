// @vitest-environment node
import { expect, test } from "vitest";
import { GET, dynamic, runtime } from "../src/app/api/health/route";

test("Next.js liveness does not query a database or provider", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(dynamic).toBe("force-dynamic");
  expect(runtime).toBe("nodejs");
});
