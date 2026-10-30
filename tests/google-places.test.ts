// @vitest-environment node
import { expect, test, vi } from "vitest";
import { GoogleTextSearchProvider } from "../src/infrastructure/server/google-places-provider";
import { validateCollectionRequest } from "../src/infrastructure/server/runtime-config";
import type { GoogleSearchDetails } from "../src/domain/google-search-details";

test("Google adapter sends exactly one HTTP request per search() call without pageToken", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    places: [{ id: "fixture-google-id", displayName: { text: "Empresa sintética" }, formattedAddress: "Endereço de teste",
      location: { latitude: -1.4, longitude: -48.4 }, attributions: [{ provider: "Fixture", providerUri: "https://example.test" }] }],
    nextPageToken: "fixture-next-page"
  }));
  const result = await new GoogleTextSearchProvider("fixture-key", transport).search("Teste", "Belém, PA, Brasil");
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
  expect(options?.headers).toMatchObject({ "X-Goog-Api-Key": "fixture-key",
    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.nationalPhoneNumber,places.websiteUri,places.attributions,nextPageToken" });
  const body = JSON.parse(String(options?.body));
  expect(body).toEqual({ textQuery: "Teste em Belém, PA, Brasil", languageCode: "pt-BR", regionCode: "BR", pageSize: 20 });
  expect(body).not.toHaveProperty("pageToken");
  expect(options?.cache).toBe("no-store");
  expect(result.limited).toBe(true);
  expect(result.nextPageToken).toBe("fixture-next-page");
  expect(result.places[0]).toMatchObject({ id: "fixture-google-id", name: "Empresa sintética", latitude: -1.4 });
});

test("Google adapter includes pageToken in body when continuing pagination", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    places: [{ id: "fixture-page2-id", displayName: { text: "Empresa página 2" }, formattedAddress: "Rua 2", attributions: [] }]
  }));
  const result = await new GoogleTextSearchProvider("fixture-key", transport).search("Teste", "Belém", "token-pagina-anterior");
  expect(transport).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
  expect(body).toMatchObject({ textQuery: "Teste em Belém", pageToken: "token-pagina-anterior" });
  expect(result.nextPageToken).toBeUndefined();
  expect(result.limited).toBe(false);
});

test.each([403, 429, 500])("Google status %s returns a safe explicit error without automatic retries", async (status) => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ secret: "do not reveal" }, { status }));
  await expect(new GoogleTextSearchProvider("fixture-key", transport).search("Teste", "Belém")).rejects.toMatchObject({ code: "GOOGLE_REQUEST_FAILED", status: status === 429 ? 429 : 502 });
  expect(transport).toHaveBeenCalledTimes(1);
});

test("network failure and malformed response do not masquerade as zero results", async () => {
  const failure = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret transport detail"));
  await expect(new GoogleTextSearchProvider("fixture", failure).search("Teste", "Belém")).rejects.toMatchObject({ code: "GOOGLE_CONNECTION_FAILED" });
  const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ places: [{ id: 2 }] }));
  await expect(new GoogleTextSearchProvider("fixture", malformed).search("Teste", "Belém")).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
});

test("shared billing starts blocked and accepts only explicitly allocated free allowance", () => {
  const env = { GOOGLE_COLLECTION_ENABLED: "true", GOOGLE_PLACES_API_KEY: "fixture",
    GOOGLE_PLACES_POLICY_ACKNOWLEDGED: "true", GOOGLE_PLACES_BILLING_SCOPE: "fixture-scope" };
  expect(() => validateCollectionRequest(env)).toThrow(/franquia/);
  expect(() => validateCollectionRequest({ ...env, GOOGLE_PLACES_MONTHLY_LIMIT: "5001" })).toThrow(/0 e 5000/);
  expect(() => validateCollectionRequest({ ...env, GOOGLE_PLACES_MONTHLY_LIMIT: "100" })).not.toThrow();
});

test("request and raw response details preserve Google fields and redact credentials and pagination tokens", async () => {
  const traces: GoogleSearchDetails[] = [];
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    places: [{ id: "raw-place", displayName: { text: "Empresa sintética" }, nationalPhoneNumber: "0000" }],
    nextPageToken: "private-next-token",
    extra: { authorization: "private-authorization", api_key: "private-other-key", message: "private-key private-input-token private-next-token" }
  }));
  const result = await new GoogleTextSearchProvider("private-key", transport)
    .search("Teste", "Belém", "private-input-token", async (details) => { traces.push(structuredClone(details)); });
  expect(result.nextPageToken).toBe("private-next-token");
  expect(traces).toHaveLength(2);
  expect(traces[0].response).toBeUndefined();
  expect(traces[0].request).toMatchObject({
    method: "POST", url: "https://places.googleapis.com/v1/places:searchText",
    headers: { "X-Goog-Api-Key": "[REDACTED]" },
    body: { textQuery: "Teste em Belém", pageSize: 20, pageToken: "[REDACTED]" }
  });
  expect(traces[1].response).toMatchObject({
    httpStatus: 200, truncated: false,
    body: { places: [{ id: "raw-place", displayName: { text: "Empresa sintética" }, nationalPhoneNumber: "0000" }], nextPageToken: "[REDACTED]" }
  });
  for (const secret of ["private-key", "private-input-token", "private-next-token", "private-authorization", "private-other-key"]) {
    expect(JSON.stringify(traces)).not.toContain(secret);
  }
});

test.each([403, 429, 500])("details capture the actual Google HTTP %s and sanitized error body", async (status) => {
  const observe = vi.fn<(details: GoogleSearchDetails) => Promise<void>>().mockResolvedValue(undefined);
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    error: { code: status, status: "PERMISSION_DENIED", message: "Invalid key=private-key", details: [{ token: "hidden" }] }
  }, { status }));
  await expect(new GoogleTextSearchProvider("private-key", transport).search("Teste", "Belém", undefined, observe))
    .rejects.toMatchObject({ code: "GOOGLE_REQUEST_FAILED" });
  expect(observe.mock.calls[1][0].response).toMatchObject({
    httpStatus: status, body: { error: { code: status, status: "PERMISSION_DENIED", details: [{ token: "[REDACTED]" }] } }
  });
  expect(JSON.stringify(observe.mock.calls)).not.toContain("private-key");
  expect(JSON.stringify(observe.mock.calls)).not.toContain('"hidden"');
});

test("network and invalid JSON responses have explicit trace details without leaked transport errors", async () => {
  const observe = vi.fn<(details: GoogleSearchDetails) => Promise<void>>().mockResolvedValue(undefined);
  await expect(new GoogleTextSearchProvider("private-key", vi.fn().mockRejectedValue(new Error("sensitive-network")))
    .search("Teste", "Belém", undefined, observe)).rejects.toMatchObject({ code: "GOOGLE_CONNECTION_FAILED" });
  expect(observe.mock.calls[1][0].response).toMatchObject({ httpStatus: null, errorCode: "GOOGLE_CONNECTION_FAILED", body: null });
  expect(JSON.stringify(observe.mock.calls)).not.toContain("sensitive-network");
  observe.mockClear();
  await expect(new GoogleTextSearchProvider("private-key", vi.fn().mockResolvedValue(new Response("<html>key=private-key</html>")))
    .search("Teste", "Belém", undefined, observe)).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
  expect(observe.mock.calls[1][0].response?.httpStatus).toBe(200);
  expect(JSON.stringify(observe.mock.calls)).not.toContain("private-key");
});

test("oversized details are explicitly truncated after sanitization", async () => {
  const observe = vi.fn<(details: GoogleSearchDetails) => Promise<void>>().mockResolvedValue(undefined);
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    places: [], nextPageToken: "hidden-token", extra: "x".repeat(1024 * 1024)
  }));
  await new GoogleTextSearchProvider("private-key", transport).search("Teste", "Belém", undefined, observe);
  expect(observe.mock.calls[1][0].response?.truncated).toBe(true);
  expect(JSON.stringify(observe.mock.calls)).not.toContain("hidden-token");
});

test("failure to persist the request is explicit and prevents sending an unlogged Google call", async () => {
  const transport = vi.fn<typeof fetch>();
  const observe = vi.fn().mockRejectedValue(new Error("Details storage unavailable"));
  await expect(new GoogleTextSearchProvider("private-key", transport).search("Teste", "Belém", undefined, observe))
    .rejects.toThrow("Details storage unavailable");
  expect(transport).not.toHaveBeenCalled();
});
