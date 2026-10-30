import type { Place, PortalState } from "../domain/types";

export function createDemoState(): PortalState {
  const places: Place[] = [
    { id: "demo-01", name: "Clínica Exemplo Centro", address: "Área central · localização demonstrativa", category: "Saúde e bem-estar", latitude: -1.4558, longitude: -48.5044 },
    { id: "demo-02", name: "Loja Modelo Norte", address: "Região norte · localização demonstrativa", category: "Comércio especializado", latitude: -1.3850, longitude: -48.4420 },
    { id: "demo-03", name: "Centro de Atendimento Demo", address: "Região oeste · localização demonstrativa", category: "Serviços", latitude: -1.4700, longitude: -48.5200 },
    { id: "demo-04", name: "Espaço Referência Sul", address: "Região sul · localização demonstrativa", category: "Saúde e bem-estar", latitude: -1.5100, longitude: -48.4900 },
    { id: "demo-05", name: "Unidade Ilustrativa Leste", address: "Região leste · localização demonstrativa", category: "Comércio especializado", latitude: -1.4300, longitude: -48.4100 }
  ];
  return {
    page: "dashboard",
    mobileView: "map",
    activeSearchId: "search-demo",
    openTabs: ["search-demo"],
    searchFilter: "",
    visibility: "visible",
    favoriteOnly: false,
    searches: [{
      id: "search-demo", term: "Aparelho auditivo", city: "Belém, PA, Brasil",
      placeIds: places.map((place) => place.id), hiddenIds: [],
      createdAt: new Date().toISOString(), demo: true
    }],
    places: Object.fromEntries(places.map((place) => [place.id, place])),
    favorites: [], overrides: {}, comments: {}
  };
}
