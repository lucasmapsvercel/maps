import { useState } from "react";
import type { Page, PortalRepository } from "../domain/types";
import type { PortalConnection } from "../application/portal-connection";
import { usePortal } from "./use-portal";
import { Heading } from "./components/common";
import { Layout, pageLabels } from "./components/layout";
import { Dashboard } from "./components/dashboard";
import { Favorites, SavedSearches, Settings } from "./components/pages";
import { SearchDialog } from "./components/search-dialog";
import { PlaceDetails } from "./components/place-details";

const subtitles: Record<Page, string> = {
  dashboard: "Organize seus resultados e acompanhe cada pesquisa.",
  saved: "Pesquisas permanecem disponíveis mesmo quando você fecha uma aba.",
  favorites: "Estabelecimentos favoritados ficam disponíveis em todo o workspace.",
  settings: "Integrações e políticas do ambiente MAPS."
};

export function App(props: { repository: PortalRepository } | { connection: PortalConnection }) {
  const portal = usePortal("connection" in props ? props.connection : props.repository);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selection, setSelection] = useState<{ id: string; page: Page; searchId: string | null } | null>(null);
  const selectedId = selection && selection.page === portal.state.page &&
    (portal.state.page === "dashboard" ? selection.searchId === portal.state.activeSearchId &&
      portal.service.activeSearch()?.placeIds.includes(selection.id)
      : portal.state.page === "favorites" && portal.state.favorites.includes(selection.id)) &&
    portal.state.places[selection.id] ? selection.id : null;
  const select = (id: string) => setSelection({ id, page: portal.state.page, searchId: portal.state.activeSearchId });
  return <Layout portal={portal}>
    <Heading title={pageLabels[portal.state.page]} subtitle={subtitles[portal.state.page]} onNewSearch={() => setSearchOpen(true)} />
    {portal.state.page === "dashboard" && <Dashboard portal={portal} onNewSearch={() => setSearchOpen(true)} onSelect={select} selectedId={selectedId} />}
    {portal.state.page === "saved" && <SavedSearches portal={portal} />}
    {portal.state.page === "favorites" && <Favorites portal={portal} onSelect={select} selectedId={selectedId} />}
    {portal.state.page === "settings" && <Settings remote={portal.remote} />}
    {selectedId && <PlaceDetails key={selectedId} portal={portal} id={selectedId} onClose={() => setSelection(null)} />}
    {searchOpen && <SearchDialog portal={portal} onClose={() => setSearchOpen(false)} />}
  </Layout>;
}
