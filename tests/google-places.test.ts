// @vitest-environment node
import { expect, test, vi } from "vitest";
import { GoogleTextSearchProvider } from "../src/infrastructure/server/google-places-provider";
import { validateCollectionRequest } from "../src/infrastructure/server/runtime-config";

test("Google adapter requests only Pro fields with exactly one call and never follows pagination", async () => {
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
    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.attributions,nextPageToken" });
  expect(JSON.parse(String(options?.body))).toEqual({ textQuery: "Teste em Belém, PA, Brasil", languageCode: "pt-BR", regionCode: "BR", pageSize: 20 });
  expect(options?.cache).toBe("no-store");
  expect(result.limited).toBe(true);
  expect(result.places[0]).toMatchObject({ id: "fixture-google-id", name: "Empresa sintética", latitude: -1.4 });
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
