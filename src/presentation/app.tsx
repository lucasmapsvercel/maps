import { useState } from "react";
import type { Page, PortalRepository } from "../domain/types";
import type { PortalConnection } from "../application/portal-connection";
import { usePortal } from "./use-portal";
import { Heading } from "./components/common";
import { Layout, pageLabels } from "./components/layout";
import { Dashboard } from "./components/dashboard";
import { Favorites, SavedSearches, Settings } from "./components/pages";
import { SearchDialog } from "./components/search-dialog";
import { PlaceDialog } from "./components/place-dialog";

const subtitles: Record<Page, string> = {
  dashboard: "Organize seus resultados e acompanhe cada pesquisa.",
  saved: "Pesquisas permanecem disponíveis mesmo quando você fecha uma aba.",
  favorites: "Estabelecimentos favoritados ficam disponíveis em todo o workspace.",
  settings: "Integrações e políticas do ambiente MAPS."
};

export function App(props: { repository: PortalRepository } | { connection: PortalConnection }) {
  const portal = usePortal("connection" in props ? props.connection : props.repository);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const select = (id: string) => { setSelectedId(id); setDetailOpen(true); };
  return <Layout portal={portal}>
    <Heading title={pageLabels[portal.state.page]} subtitle={subtitles[portal.state.page]} onNewSearch={() => setSearchOpen(true)} />
    {portal.state.page === "dashboard" && <Dashboard portal={portal} onNewSearch={() => setSearchOpen(true)} onSelect={select} selectedId={selectedId} />}
    {portal.state.page === "saved" && <SavedSearches portal={portal} />}
    {portal.state.page === "favorites" && <Favorites portal={portal} onSelect={select} selectedId={selectedId} />}
    {portal.state.page === "settings" && <Settings remote={portal.remote} />}
    {searchOpen && <SearchDialog portal={portal} onClose={() => setSearchOpen(false)} />}
    {detailOpen && selectedId && <PlaceDialog key={selectedId} portal={portal} id={selectedId} onClose={() => setDetailOpen(false)} />}
  </Layout>;
}
