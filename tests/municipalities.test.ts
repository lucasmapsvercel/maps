// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { IbgeMunicipalities, ibgeMunicipalities } from "../src/infrastructure/server/ibge-municipalities";
import { filterMunicipalities, municipalityCity, type Municipality } from "../src/domain/municipality";
import { GET } from "../src/app/api/v1/municipalities/route";
import * as auth from "../src/infrastructure/server/auth";
import backup from "../src/infrastructure/data/ibge-municipalities.json";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const belem: Municipality = { ibgeCode: "1501402", name: "Belém", stateCode: "PA", stateName: "Pará", country: "Brasil" };
const payload = [{
  id: 1501402, nome: "Belém", microrregiao: null,
  "regiao-imediata": { "regiao-intermediaria": { UF: { sigla: "PA", nome: "Pará" } } }
}, {
  id: 2700805, nome: "Belém", microrregiao: { mesorregiao: { UF: { sigla: "AL", nome: "Alagoas" } } }
}, ...backup.municipalities.filter((item) => !["1501402", "2700805"].includes(item.ibgeCode)).map((item) => ({
  id: Number(item.ibgeCode), nome: item.name, microrregiao: null,
  "regiao-imediata": { "regiao-intermediaria": { UF: { sigla: item.stateCode, nome: item.stateName } } }
}))];

test("IBGE catalog normalizes both regional formats and coalesces/cache successful loads", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
  const catalog = new IbgeMunicipalities(transport);
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  expect(first).toEqual(second);
  expect(first[0]).toEqual(belem);
  expect(first[1]).toMatchObject({ ibgeCode: "2700805", stateCode: "AL" });
  expect(await catalog.list()).toEqual(first);
  expect(await catalog.catalog()).toMatchObject({ source: "ibge", updatedAt: expect.any(String) });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
});

test.each(["network", "http", "json", "schema", "missing-state", "partial", "duplicate"])("IBGE %s failure uses a verified backup and retries after five minutes", async (failure) => {
  vi.useFakeTimers();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = vi.fn<typeof fetch>();
  if (failure === "network") transport.mockRejectedValueOnce(new Error("network"));
  else transport.mockResolvedValueOnce(failure === "http" ? new Response("", { status: 503 })
    : failure === "json" ? new Response("not JSON")
      : Response.json(failure === "missing-state" ? [{ id: 1501402, nome: "Belém" }]
        : failure === "partial" ? payload.slice(0, 2)
          : failure === "duplicate" ? [...payload, payload[0]] : []));
  transport.mockResolvedValueOnce(Response.json(payload));
  const catalog = new IbgeMunicipalities(transport);
  const result = await catalog.catalog();
  expect(result).toMatchObject({ source: "backup", updatedAt: backup.updatedAt });
  expect(result.municipalities).toEqual(backup.municipalities);
  expect(result.municipalities.length).toBeGreaterThanOrEqual(5500);
  expect(new Set(result.municipalities.map((item) => item.stateCode)).size).toBe(27);
  expect(result.municipalities).toContainEqual(belem);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('"event":"ibge_catalog_backup"'));
  expect(await catalog.list()).toEqual(result.municipalities);
  expect(transport).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300_000);
  expect((await catalog.list())[0]).toEqual(belem);
  expect((await catalog.catalog()).source).toBe("ibge");
  expect(transport).toHaveBeenCalledTimes(2);
});

test("an outage after cache expiry preserves the most recently fetched catalog and its date", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(payload)).mockRejectedValue(new Error("outage"));
  const catalog = new IbgeMunicipalities(transport);
  const live = await catalog.catalog();
  vi.advanceTimersByTime(86400_000);
  const fallback = await catalog.catalog();
  expect(fallback).toEqual({ ...live, source: "backup" });
  expect(transport).toHaveBeenCalledTimes(2);
});

test("municipality filter distinguishes homonyms, searches UF/state and ignores accents", () => {
  const municipalities = [belem, { ...belem, ibgeCode: "2700805", stateCode: "AL" as const, stateName: "Alagoas" }];
  expect(filterMunicipalities(municipalities, "belem")).toHaveLength(2);
  expect(filterMunicipalities(municipalities, "BeLeM pa")).toEqual([belem]);
  expect(filterMunicipalities(municipalities, "Belém, PA")).toEqual([belem]);
  expect(filterMunicipalities(municipalities, "Belém — PA")).toEqual([belem]);
  expect(filterMunicipalities(municipalities, "belem alagoas")).toHaveLength(1);
  expect(filterMunicipalities(municipalities, " ")).toEqual([]);
  expect(municipalityCity(belem)).toBe("Belém, Pará, Brasil");
});

test("municipality endpoint requires authentication and uses no Google API", async () => {
  const actor = vi.spyOn(auth, "currentActor").mockResolvedValue(null);
  const data = { municipalities: [belem], source: "backup" as const, updatedAt: backup.updatedAt };
  const catalog = vi.spyOn(ibgeMunicipalities, "catalog").mockResolvedValue(data);
  const request = () => new Request("http://localhost:3000/api/v1/municipalities");
  expect((await GET(request())).status).toBe(401);
  expect(catalog).not.toHaveBeenCalled();
  actor.mockResolvedValue({ workspaceId: "maps", userId: "fixture", name: "Fixture" });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(data);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
