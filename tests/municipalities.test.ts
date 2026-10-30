// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { IbgeMunicipalities, ibgeMunicipalities } from "../src/infrastructure/server/ibge-municipalities";
import { filterMunicipalities, municipalityCity, type Municipality } from "../src/domain/municipality";
import { GET } from "../src/app/api/v1/municipalities/route";
import * as auth from "../src/infrastructure/server/auth";

afterEach(() => vi.restoreAllMocks());

const belem: Municipality = { ibgeCode: "1501402", name: "Belém", stateCode: "PA", stateName: "Pará", country: "Brasil" };
const payload = [{
  id: 1501402, nome: "Belém", microrregiao: null,
  "regiao-imediata": { "regiao-intermediaria": { UF: { sigla: "PA", nome: "Pará" } } }
}, {
  id: 2700805, nome: "Belém", microrregiao: { mesorregiao: { UF: { sigla: "AL", nome: "Alagoas" } } }
}];

test("IBGE catalog normalizes both regional formats and coalesces/cache successful loads", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
  const catalog = new IbgeMunicipalities(transport);
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  expect(first).toEqual(second);
  expect(first[0]).toEqual(belem);
  expect(first[1]).toMatchObject({ ibgeCode: "2700805", stateCode: "AL" });
  expect(await catalog.list()).toEqual(first);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
});

test.each(["network", "http", "json", "schema", "missing-state"])("IBGE %s failures are explicit and retryable", async (failure) => {
  const transport = vi.fn<typeof fetch>();
  if (failure === "network") transport.mockRejectedValueOnce(new Error("network"));
  else transport.mockResolvedValueOnce(failure === "http" ? new Response("", { status: 503 })
    : failure === "json" ? new Response("not JSON")
      : Response.json(failure === "missing-state" ? [{ id: 1501402, nome: "Belém" }] : []));
  transport.mockResolvedValueOnce(Response.json(payload));
  const catalog = new IbgeMunicipalities(transport);
  await expect(catalog.list()).rejects.toMatchObject({ status: 502 });
  expect((await catalog.list())[0]).toEqual(belem);
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
  const catalog = vi.spyOn(ibgeMunicipalities, "list").mockResolvedValue([belem]);
  const request = () => new Request("http://localhost:3000/api/v1/municipalities");
  expect((await GET(request())).status).toBe(401);
  expect(catalog).not.toHaveBeenCalled();
  actor.mockResolvedValue({ workspaceId: "maps", userId: "fixture", name: "Fixture" });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ municipalities: [belem] });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
