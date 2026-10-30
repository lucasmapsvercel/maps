import { expect, test } from "vitest";
import { PortalService } from "../src/application/portal-service";
import { createDemoState } from "../src/infrastructure/demo-state";
import { LocalStorageRepository, STORAGE_KEY } from "../src/infrastructure/local-storage-repository";
import { validateState } from "../src/domain/portal-state";

function fixture() {
  const saved = new Map<string, string>();
  const repository = new LocalStorageRepository({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  });
  const service = new PortalService({
    state: createDemoState(), repository,
    clock: () => "2026-10-29T12:00:00.000Z", createId: () => "test"
  });
  return { service, repository, saved };
}

test("creating and closing a search preserves existing searches and persists across reload", () => {
  const { service, repository } = fixture();
  service.addSearch("  Farmácia  ", " Belém, PA, Brasil ");
  expect(service.activeSearch()?.term).toBe("Farmácia");
  expect(service.activeSearch()?.placeIds).toEqual([]);
  expect(service.activeSearch()?.createdAt).toBe("2026-10-29T12:00:00.000Z");
  service.closeTab("search-test");
  expect(service.state.searches).toHaveLength(2);
  service.save();
  expect(repository.load()).toEqual(service.state);
});

test("deleting a saved search closes its tab and preserves places, favorites and annotations", () => {
  const { service, repository } = fixture();
  service.toggleFavorite("demo-01");
  service.addComment("demo-01", "Preservar comentário");
  service.editPlace("demo-01", { phone: "0000" });
  service.addSearch("Outra busca", "Belém");
  const { places, favorites, comments, overrides } = structuredClone(service.state);
  service.execute({ type: "deleteSearch", id: "search-test" });
  expect(service.state.activeSearchId).toBe("search-demo");
  expect(service.state.openTabs).toEqual(["search-demo"]);
  service.execute({ type: "deleteSearch", id: "search-demo" });
  expect(service.state.activeSearchId).toBeNull();
  expect(service.state.openTabs).toEqual([]);
  expect(service.state.searches).toEqual([]);
  expect(service.state).toMatchObject({ places, favorites, comments, overrides });
  service.save();
  expect(repository.load()).toEqual(service.state);
  expect(() => service.deleteSearch("missing")).toThrow("Busca não encontrada");
});

test("search validation rejects empty city and terms outside 2..200 characters without mutation", () => {
  const { service } = fixture();
  for (const [term, city] of [["a", "Belém"], ["a".repeat(201), "Belém"], ["Clínica", " "]]) {
    expect(() => service.addSearch(term, city)).toThrow();
  }
  expect(service.state.searches).toHaveLength(1);
  service.addSearch("a".repeat(200), "Belém");
  expect(service.activeSearch()?.term).toHaveLength(200);
});

test("selected municipalities produce standardized Google query cities and legacy saved searches remain valid", () => {
  const { service, repository } = fixture();
  const municipality = { ibgeCode: "1501402", name: "Belém", stateCode: "PA" as const, stateName: "Pará", country: "Brasil" as const };
  service.execute({ type: "addSearch", term: "Farmácia", city: "Ignored free text", municipality });
  expect(service.activeSearch()).toMatchObject({ city: "Belém, Pará, Brasil", municipality });
  service.save();
  expect(repository.load()?.searches[0].municipality).toEqual(municipality);
  expect(repository.load()?.searches[1].municipality).toBeUndefined();
  expect(() => validateState({ ...service.state, searches: [{ ...service.state.searches[0], municipality: { ...municipality, ibgeCode: "invalid" } }] })).toThrow();
});

test("favorites, comments and overrides belong to a place; hiding belongs to the active search", () => {
  const { service, repository } = fixture();
  service.addSearch("Farmácia", "Belém");
  const search = service.activeSearch();
  if (!search) throw new Error("Missing test search");
  search.placeIds.push("demo-01");
  service.toggleHidden("demo-01");
  service.toggleFavorite("demo-01");
  service.addComment("demo-01", "  Contato de demonstração  ");
  service.editPlace("demo-01", { phone: "0000", website: "https://example.invalid" });
  expect(service.visiblePlaceIds()).toEqual([]);
  service.openSearch("search-demo");
  expect(service.visiblePlaceIds()).toContain("demo-01");
  expect(service.state.favorites).toContain("demo-01");
  expect(service.state.comments["demo-01"][0].text).toBe("Contato de demonstração");
  expect(service.getPlace("demo-01").phone).toBe("0000");
  expect(service.state.places["demo-01"].phone).toBeUndefined();
  service.save();
  expect(repository.load()?.overrides["demo-01"].phone).toBe("0000");
  service.clearOverrides("demo-01");
  expect(service.getPlace("demo-01").phone).toBeUndefined();
});

test("local filters agree on visible, hidden, text and favorite subsets", () => {
  const { service } = fixture();
  service.toggleHidden("demo-01");
  expect(service.visiblePlaceIds()).toHaveLength(4);
  service.setFilter("visibility", "hidden");
  expect(service.visiblePlaceIds()).toEqual(["demo-01"]);
  service.setFilter("visibility", "all");
  service.setFilter("searchFilter", "CLÍNICA");
  expect(service.visiblePlaceIds()).toEqual(["demo-01"]);
  service.setFilter("favoriteOnly", true);
  expect(service.visiblePlaceIds()).toEqual([]);
  service.toggleFavorite("demo-01");
  expect(service.visiblePlaceIds()).toEqual(["demo-01"]);
  service.setFilter("visibility", "visible");
  expect(service.visiblePlaceIds()).toEqual([]);
});

test("invalid comments, URLs, IDs and filters fail explicitly", () => {
  const { service } = fixture();
  expect(() => service.addComment("demo-01", " ")).toThrow();
  expect(() => service.addComment("demo-01", "x".repeat(501))).toThrow();
  expect(() => service.editPlace("demo-01", { website: "javascript:alert(1)" })).toThrow();
  expect(() => service.editPlace("demo-01", { website: "https://" })).toThrow();
  expect(() => service.toggleFavorite("missing")).toThrow();
  expect(() => service.openSearch("missing")).toThrow();
  // @ts-expect-error Invalid visibility must be rejected both at compile time and at runtime.
  expect(() => service.setFilter("visibility", "invalid")).toThrow();
  expect(service.state.overrides["demo-01"]).toBeUndefined();
});

test("repository preserves the legacy key, validates saved data and migrates absent mobileView", () => {
  const { repository, saved } = fixture();
  expect(repository.load()).toBeNull();
  saved.set(STORAGE_KEY, '{"searches":[]}');
  expect(() => repository.load()).toThrow(/formato esperado/);
  saved.set(STORAGE_KEY, "not json");
  expect(() => repository.load()).toThrow(SyntaxError);
  const { mobileView: _mobileView, ...legacyState } = createDemoState();
  expect(validateState(legacyState).mobileView).toBe("map");
  expect(() => validateState({ ...createDemoState(), places: { invalid: { x: "invalid" } } })).toThrow();
  expect(() => validateState({ ...createDemoState(), comments: { invalid: [{ text: 10 }] } })).toThrow();
});
