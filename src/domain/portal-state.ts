import type { Comment, LocalOverrides, Place, PortalState, SavedSearch } from "./types";
import { ValidationError } from "./validation-error";
import { municipalitySchema } from "./municipality";

export function validateSearch(term: string, city: string) {
  const search = { term: term.trim(), city: city.trim() };
  if (search.term.length < 2 || search.term.length > 200 || !search.city) {
    throw new ValidationError("Informe um termo de 2 a 200 caracteres e um município.");
  }
  return search;
}

export function effectivePlace(state: PortalState, id: string): Place {
  const place = Object.hasOwn(state.places, id) ? state.places[id] : undefined;
  if (!place) throw new ValidationError("Estabelecimento não encontrado.");
  return { ...place, ...(state.overrides[id] || {}) };
}

export function filterPlaceIds(state: PortalState, search: SavedSearch | null): string[] {
  if (!search) return [];
  const query = state.searchFilter.trim().toLocaleLowerCase("pt-BR");
  return search.placeIds.filter((id) => {
    if (!state.places[id]) return false;
    const hidden = search.hiddenIds.includes(id);
    if (state.visibility === "visible" && hidden) return false;
    if (state.visibility === "hidden" && !hidden) return false;
    if (state.favoriteOnly && !state.favorites.includes(id)) return false;
    const place = effectivePlace(state, id);
    return !query || [place.name, place.address, place.category]
      .some((value) => value.toLocaleLowerCase("pt-BR").includes(query));
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === "string");

function isSearch(value: unknown): value is SavedSearch {
  return record(value) && ["id", "term", "city", "createdAt"].every((key) => typeof value[key] === "string")
    && typeof value.demo === "boolean" && strings(value.placeIds) && strings(value.hiddenIds)
    && (value.municipality === undefined || municipalitySchema.safeParse(value.municipality).success);
}

function isPlace(value: unknown): value is Place {
  return record(value) && ["id", "name", "address", "category"].every((key) => typeof value[key] === "string")
    && ["phone", "website"].every((key) => value[key] === undefined || typeof value[key] === "string")
    && (value.latitude === undefined || (typeof value.latitude === "number" && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90))
    && (value.longitude === undefined || (typeof value.longitude === "number" && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180));
}

function isOverride(value: unknown): value is LocalOverrides {
  return record(value) && Object.entries(value)
    .every(([key, field]) => ["phone", "website"].includes(key) && typeof field === "string");
}

function isComments(value: unknown): value is Comment[] {
  return Array.isArray(value) && value.every((comment: unknown) =>
    record(comment) && typeof comment.text === "string" && typeof comment.createdAt === "string"
    && ["authorId", "authorName"].every((key) => comment[key] === undefined || typeof comment[key] === "string"));
}

function isState(value: unknown): value is PortalState {
  return record(value)
    && (value.page === "dashboard" || value.page === "saved" || value.page === "favorites" || value.page === "settings")
    && (value.activeSearchId === null || typeof value.activeSearchId === "string")
    && (value.mobileView === "map" || value.mobileView === "list")
    && strings(value.openTabs) && strings(value.favorites)
    && typeof value.searchFilter === "string"
    && (value.visibility === "visible" || value.visibility === "hidden" || value.visibility === "all")
    && typeof value.favoriteOnly === "boolean"
    && Array.isArray(value.searches) && value.searches.every(isSearch)
    && record(value.places) && Object.values(value.places).every(isPlace)
    && record(value.overrides) && Object.values(value.overrides).every(isOverride)
    && record(value.comments) && Object.values(value.comments).every(isComments);
}

export function validateState(value: unknown): PortalState {
  const migrated: unknown = record(value) && value.mobileView === undefined ? { ...value, mobileView: "map" } : value;
  if (!isState(migrated)) throw new ValidationError("Os dados salvos não correspondem ao formato esperado.");
  return migrated;
}
