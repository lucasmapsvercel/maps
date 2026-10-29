import { effectivePlace, filterPlaceIds, validateSearch } from "../domain/portal-state";
import type { LocalOverrides, Page, PortalFilters, PortalRepository, PortalState } from "../domain/types";
import type { PortalCommand } from "../domain/portal-command";
import { ValidationError } from "../domain/validation-error";

export class PortalService {
  state: PortalState;
  private readonly repository?: Pick<PortalRepository, "save">;
  private readonly clock: () => string;
  private readonly createId: () => string;

  constructor({ state, repository, clock = () => new Date().toISOString(), createId = () => crypto.randomUUID() }: {
    state: PortalState;
    repository?: Pick<PortalRepository, "save">;
    clock?: () => string;
    createId?: () => string;
  }) {
    this.state = state;
    this.repository = repository;
    this.clock = clock;
    this.createId = createId;
  }

  save() {
    if (!this.repository) throw new Error("Persistência não configurada.");
    this.repository.save(this.state);
  }

  execute(command: PortalCommand) {
    switch (command.type) {
      case "addSearch": return this.addSearch(command.term, command.city);
      case "openSearch": return this.openSearch(command.id);
      case "closeTab": return this.closeTab(command.id);
      case "navigate": return this.navigate(command.page);
      case "toggleFavorite": return this.toggleFavorite(command.id);
      case "toggleHidden": return this.toggleHidden(command.id);
      case "addComment": return this.addComment(command.id, command.text);
      case "editPlace": return this.editPlace(command.id, command);
      case "clearOverrides": return this.clearOverrides(command.id);
      case "setFilter": {
        const filter = command.filter;
        switch (filter.name) {
          case "searchFilter": return this.setFilter(filter.name, filter.value);
          case "visibility": return this.setFilter(filter.name, filter.value);
          case "mobileView": return this.setFilter(filter.name, filter.value);
          case "favoriteOnly": return this.setFilter(filter.name, filter.value);
        }
      }
    }
  }

  activeSearch() {
    return this.state.searches.find((search) => search.id === this.state.activeSearchId) || null;
  }

  getPlace(id: string) {
    return effectivePlace(this.state, id);
  }

  visiblePlaceIds(search = this.activeSearch()) {
    return filterPlaceIds(this.state, search);
  }

  searchForPlace(id: string) {
    const active = this.activeSearch();
    return active?.placeIds.includes(id) ? active
      : this.state.searches.find((search) => search.placeIds.includes(id)) || null;
  }

  addSearch(term: string, city: string) {
    const values = validateSearch(term, city);
    const search = {
      id: `search-${this.createId()}`, ...values, placeIds: [], hiddenIds: [],
      createdAt: this.clock(), demo: false
    };
    this.state.searches.unshift(search);
    this.openSearch(search.id);
  }

  openSearch(id: string) {
    if (!this.state.searches.some((search) => search.id === id)) throw new ValidationError("Busca não encontrada.");
    this.state.activeSearchId = id;
    if (!this.state.openTabs.includes(id)) this.state.openTabs.push(id);
    this.state.page = "dashboard";
    this.state.visibility = "visible";
    this.state.searchFilter = "";
  }

  closeTab(id: string) {
    this.state.openTabs = this.state.openTabs.filter((tab) => tab !== id);
    if (this.state.activeSearchId === id) {
      this.state.activeSearchId = this.state.openTabs.at(-1) || null;
    }
  }

  navigate(page: Page) {
    if (!["dashboard", "saved", "favorites", "settings"].includes(page)) throw new ValidationError("Página inválida.");
    this.state.page = page;
    if (page === "dashboard" && !this.activeSearch() && this.state.searches.length) {
      this.openSearch(this.state.searches[0].id);
    }
  }

  toggleFavorite(id: string) {
    this.getPlace(id);
    this.state.favorites = this.state.favorites.includes(id)
      ? this.state.favorites.filter((item) => item !== id) : [...this.state.favorites, id];
  }

  toggleHidden(id: string) {
    this.getPlace(id);
    const search = this.searchForPlace(id);
    if (!search) throw new ValidationError("Estabelecimento sem vínculo com uma busca.");
    search.hiddenIds = search.hiddenIds.includes(id)
      ? search.hiddenIds.filter((item) => item !== id) : [...search.hiddenIds, id];
  }

  addComment(id: string, text: string) {
    this.getPlace(id);
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 500) throw new ValidationError("O comentário deve ter de 1 a 500 caracteres.");
    this.state.comments[id] ||= [];
    this.state.comments[id].push({ text: trimmed, createdAt: this.clock() });
  }

  editPlace(id: string, { phone = "", website = "" }: LocalOverrides) {
    this.getPlace(id);
    phone = phone.trim();
    website = website.trim();
    if (phone.length > 60 || website.length > 200) throw new ValidationError("Telefone ou website excede o limite de caracteres.");
    if (website) {
      let url;
      try { url = new URL(website); } catch { throw new ValidationError("Informe um website válido com http:// ou https://."); }
      if (!["http:", "https:"].includes(url.protocol)) throw new ValidationError("O website deve começar com http:// ou https://.");
    }
    this.state.overrides[id] = { ...(phone ? { phone } : {}), ...(website ? { website } : {}) };
  }

  clearOverrides(id: string) {
    this.getPlace(id);
    delete this.state.overrides[id];
  }

  setFilter<K extends keyof PortalFilters>(name: K, value: PortalFilters[K]) {
    if (name === "visibility" && value !== "visible" && value !== "hidden" && value !== "all") throw new ValidationError("Visibilidade inválida.");
    if (name === "mobileView" && value !== "map" && value !== "list") throw new ValidationError("Exibição inválida.");
    if (name === "favoriteOnly" && typeof value !== "boolean") throw new ValidationError("Filtro de favoritos inválido.");
    if (name === "searchFilter" && typeof value !== "string") throw new ValidationError("Filtro de texto inválido.");
    if (!["visibility", "mobileView", "favoriteOnly", "searchFilter"].includes(name)) throw new ValidationError("Filtro desconhecido.");
    const filters: PortalFilters = this.state;
    filters[name] = value;
  }
}
