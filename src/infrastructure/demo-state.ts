import type { Place, PortalState } from "../domain/types";

export function createDemoState(): PortalState {
  const places: Place[] = [
    { id: "demo-01", name: "Clínica Exemplo Centro", address: "Área central · localização demonstrativa", category: "Saúde e bem-estar", x: 45, y: 44 },
    { id: "demo-02", name: "Loja Modelo Norte", address: "Região norte · localização demonstrativa", category: "Comércio especializado", x: 68, y: 29 },
    { id: "demo-03", name: "Centro de Atendimento Demo", address: "Região oeste · localização demonstrativa", category: "Serviços", x: 27, y: 58 },
    { id: "demo-04", name: "Espaço Referência Sul", address: "Região sul · localização demonstrativa", category: "Saúde e bem-estar", x: 57, y: 70 },
    { id: "demo-05", name: "Unidade Ilustrativa Leste", address: "Região leste · localização demonstrativa", category: "Comércio especializado", x: 79, y: 54 }
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
