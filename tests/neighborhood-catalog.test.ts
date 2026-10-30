// @vitest-environment node
import { expect, test } from "vitest";
import catalog from "../src/infrastructure/data/ibge-neighborhoods.json";
import municipalities from "../src/infrastructure/data/ibge-municipalities.json";
import { neighborhoodCatalogSchema } from "../src/infrastructure/ibge-neighborhood-catalog";
import { neighborhoodPlan } from "../src/infrastructure/server/ibge-neighborhoods";
import type { SavedSearch } from "../src/domain/types";
import { municipalitySchema } from "../src/domain/municipality";

function search(ibgeCode: string): SavedSearch {
  const municipality = municipalities.municipalities.find((item) => item.ibgeCode === ibgeCode);
  if (!municipality) throw new Error("Municipio de teste nao encontrado.");
  return {
    id: "catalog-test", term: "Teste", city: `${municipality.name}, ${municipality.stateName}, Brasil`,
    municipality: municipalitySchema.parse(municipality),
    placeIds: [], hiddenIds: [], demo: false, createdAt: "2026-10-30"
  };
}

test("the official catalog preserves 17575 neighborhoods in 895 municipalities with source and reference date", () => {
  const parsed = neighborhoodCatalogSchema.parse(catalog);
  expect(Object.keys(parsed.municipalities)).toHaveLength(895);
  expect(Object.values(parsed.municipalities).flat()).toHaveLength(17575);
  expect(parsed.referenceYear).toBe(2022);
  const known = new Set(municipalities.municipalities.map((item) => item.ibgeCode));
  expect(Object.keys(parsed.municipalities).every((code) => known.has(code))).toBe(true);
});

test("Belem resolves all 71 neighborhoods by IBGE code without a provider request", () => {
  const { neighborhoods, coverage } = neighborhoodPlan(search("1501402"));
  expect(neighborhoods).toHaveLength(71);
  expect(neighborhoods?.map((item) => item.name)).toEqual(expect.arrayContaining(["Cremação", "Nazaré", "Tenoné"]));
  expect(coverage).toEqual({ mode: "neighborhoods", total: 71, completed: 0, current: "Aeroporto", catalogDate: "2022" });
});

test("missing and legacy municipality identifiers never guess a neighborhood catalog by city name", () => {
  expect(neighborhoodPlan(search("1500131")).coverage).toEqual({
    mode: "municipality", total: 0, completed: 0, reason: "catalog_unavailable"
  });
  const legacy = search("1501402");
  delete legacy.municipality;
  expect(neighborhoodPlan(legacy).coverage.mode).toBe("municipality");
  expect(neighborhoodPlan({ ...legacy, municipality: search("1500131").municipality }).neighborhoods).toBeUndefined();
});

test("homonymous neighborhoods are grouped to avoid repeating identical Google text queries", () => {
  const plan = neighborhoodPlan(search("2607208"));
  expect(plan.neighborhoods?.filter((item) => item.name === "Centro")).toHaveLength(1);
  expect(new Set(plan.neighborhoods?.map((item) => item.name.toLocaleLowerCase("pt-BR"))).size).toBe(plan.neighborhoods?.length);
});

test("partial, duplicate or mismatched neighborhood catalogs are rejected rather than silently used", () => {
  expect(neighborhoodCatalogSchema.safeParse({ ...catalog, municipalities: { "1501402": catalog.municipalities["1501402"] } }).success).toBe(false);
  expect(neighborhoodCatalogSchema.safeParse({
    ...catalog, municipalities: { ...catalog.municipalities, "1501402": [...catalog.municipalities["1501402"], catalog.municipalities["1501402"][0]] }
  }).success).toBe(false);
  expect(neighborhoodCatalogSchema.safeParse({
    ...catalog, municipalities: { ...catalog.municipalities, "1501402": [{ code: "9999999001", name: "Invalido" }] }
  }).success).toBe(false);
});
