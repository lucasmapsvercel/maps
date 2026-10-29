// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { portalCommandSchema } from "../src/domain/portal-command";
import { readJson, verifyWriteOrigin } from "../src/infrastructure/server/api";
import { authOptions } from "../src/infrastructure/server/auth";

afterEach(() => vi.unstubAllEnvs());

test("write requests require exact trusted origin and JSON", () => {
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  expect(() => verifyWriteOrigin(new Request("http://localhost:3000", { method: "POST" }))).toThrow(/Origem/);
  expect(() => verifyWriteOrigin(new Request("http://localhost:3000", { method: "POST", headers: { origin: "https://evil.test" } }))).toThrow(/Origem/);
  expect(() => verifyWriteOrigin(new Request("http://localhost:3000", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "text/plain" } }))).toThrow(/application\/json/);
  expect(() => verifyWriteOrigin(new Request("http://localhost:3000", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" } }))).not.toThrow();
});

test("body validation limits bytes and rejects malformed JSON", async () => {
  await expect(readJson(new Request("http://localhost", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
  await expect(readJson(new Request("http://localhost", { method: "POST", body: JSON.stringify({ text: "x".repeat(8192) }) }))).rejects.toMatchObject({ status: 413 });
  expect(await readJson(new Request("http://localhost", { method: "POST", body: '{"version":0}' }))).toEqual({ version: 0 });
});

test("commands cannot inject workspace, author, source data or MongoDB operators", () => {
  expect(portalCommandSchema.safeParse({ type: "addComment", id: { $ne: null }, text: "x" }).success).toBe(false);
  expect(portalCommandSchema.safeParse({ type: "addComment", id: "demo-01", text: "x", authorId: "forged" }).success).toBe(false);
  expect(portalCommandSchema.safeParse({ type: "addSearch", term: "Teste", city: "Belém", workspaceId: "other" }).success).toBe(false);
});

test("Google sign-in requires verified and explicitly authorized email", async () => {
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("NEXTAUTH_SECRET", "test-only-secret-with-at-least-32-characters");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-only-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-only-secret");
  vi.stubEnv("AUTH_ALLOWED_EMAILS", "allowed@example.test");
  const signIn = authOptions().callbacks?.signIn;
  if (!signIn) throw new Error("Missing sign-in policy");
  const user = { id: "google-id", email: "allowed@example.test" };
  const account = { provider: "google", providerAccountId: "google-id", type: "oauth" } as const;
  expect(await signIn({ user, account, profile: { email: user.email, email_verified: true } })).toBe(true);
  expect(await signIn({ user, account, profile: { email: user.email, email_verified: false } })).toBe(false);
  expect(await signIn({ user, account, profile: { email: "other@example.test", email_verified: true } })).toBe(false);
  expect(await signIn({ user, account: { ...account, provider: "other" }, profile: { email: user.email, email_verified: true } })).toBe(false);
});
