// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { mongoUri, secret, validateServerConfig } from "../src/infrastructure/server/config";

afterEach(() => vi.unstubAllEnvs());

test("secrets require environment values and never fall back to mounted files", () => {
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  vi.stubEnv("GOOGLE_CLIENT_SECRET_FILE", "unused-secret-file");
  expect(() => secret("GOOGLE_CLIENT_SECRET")).toThrow(/Configure GOOGLE_CLIENT_SECRET/);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
  expect(secret("GOOGLE_CLIENT_SECRET")).toBe("fixture-secret");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "  ");
  expect(() => secret("GOOGLE_CLIENT_SECRET")).toThrow(/Configure/);
});

test("MongoDB requires an explicit URI without container connection fallback", () => {
  vi.stubEnv("MONGODB_URI", "");
  vi.stubEnv("MONGODB_PASSWORD", "fixture-unused");
  expect(() => mongoUri()).toThrow(/Configure MONGODB_URI/);
  vi.stubEnv("MONGODB_URI", "https://invalid.example.test");
  expect(() => mongoUri()).toThrow(/URI MongoDB/);
  for (const uri of ["mongodb://localhost:27017/MAPS_TEST", "mongodb+srv://cluster.example.test/MAPS_TEST"]) {
    vi.stubEnv("MONGODB_URI", uri);
    expect(mongoUri()).toBe(uri);
  }
});

test("Vercel configuration accepts direct server environment values", () => {
  vi.stubEnv("NEXTAUTH_URL", "https://maps-ten-ruddy.vercel.app");
  vi.stubEnv("AUTH_ALLOWED_EMAILS", "fixture@example.test");
  vi.stubEnv("PORTAL_WORKSPACE_ID", "maps");
  vi.stubEnv("MONGODB_DB_NAME", "MAPS");
  vi.stubEnv("MONGODB_URI", "mongodb+srv://cluster.example.test/MAPS");
  vi.stubEnv("NEXTAUTH_SECRET", "fixture-only-session-secret-over-32-characters");
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
  expect(() => validateServerConfig()).not.toThrow();
});
