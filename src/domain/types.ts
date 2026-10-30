export type Page = "dashboard" | "saved" | "favorites" | "settings";
export type Visibility = "visible" | "hidden" | "all";
export type MobileView = "map" | "list";

export interface Place {
  id: string;
  name: string;
  address: string;
  category: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
}

export interface SavedSearch {
  id: string;
  term: string;
  city: string;
  placeIds: string[];
  hiddenIds: string[];
  createdAt: string;
  demo: boolean;
}

export interface LocalOverrides {
  phone?: string;
  website?: string;
}

export interface Comment {
  text: string;
  createdAt: string;
  authorId?: string;
  authorName?: string;
}

export interface PortalState {
  page: Page;
  mobileView: MobileView;
  activeSearchId: string | null;
  openTabs: string[];
  searchFilter: string;
  visibility: Visibility;
  favoriteOnly: boolean;
  searches: SavedSearch[];
  places: Record<string, Place>;
  favorites: string[];
  overrides: Record<string, LocalOverrides>;
  comments: Record<string, Comment[]>;
}

export type PortalFilters = Pick<PortalState, "searchFilter" | "visibility" | "favoriteOnly" | "mobileView">;

export interface PortalRepository {
  load(): PortalState | null;
  save(state: PortalState): void;
}
