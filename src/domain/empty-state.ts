import type { PortalState } from "./types";

export function createEmptyState(): PortalState {
  return {
    page: "dashboard", mobileView: "map", activeSearchId: null, openTabs: [],
    searchFilter: "", visibility: "visible", favoriteOnly: false,
    searches: [], places: {}, favorites: [], overrides: {}, comments: {}
  };
}
