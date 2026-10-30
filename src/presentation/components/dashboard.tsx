import dynamic from "next/dynamic";
import type { Visibility } from "../../domain/types";
import type { Portal } from "../use-portal";
import { EmptyState } from "./common";
import { PlaceList } from "./place-list";
import { CollectionPanel } from "./collection-panel";

const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div style={{ minHeight: 360, display: "grid", placeItems: "center", background: "var(--canvas)" }}>Carregando mapa…</div>
});

function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon" aria-hidden="true">{icon}</span></div>
    <div className="metric-value">{value}</div><div className="metric-foot">{note}</div></article>;
}

export function Dashboard({ portal, onNewSearch, onSelect, selectedId }: {
  portal: Portal; onNewSearch: () => void; onSelect: (id: string) => void; selectedId: string | null;
}) {
  const { state, service, mutate } = portal;
  const search = service.activeSearch();
  const ids = service.visiblePlaceIds();
  const located = ids.filter((id) => {
    const place = service.getPlace(id);
    return place.latitude !== undefined && place.longitude !== undefined;
  });
  if (!search) return <div className="page-card"><EmptyState title="Nenhuma busca aberta">As pesquisas continuam salvas.</EmptyState>
    <div className="modal-actions"><button className="button button-quiet" onClick={() => mutate({ type: "navigate", page: "saved" })}>Ver buscas salvas</button>
      <button className="button button-primary" onClick={onNewSearch}>＋ Nova busca</button></div></div>;
  const count = search.placeIds.filter((id) => state.places[id]).length;
  const hidden = search.hiddenIds.filter((id) => state.places[id]).length;
  const mapMarkers = located.map((id) => ({ id, place: service.getPlace(id), selected: id === selectedId }));
  return <>
    <div className="search-tabs" aria-label="Buscas abertas">
      {state.openTabs.map((id) => state.searches.find((item) => item.id === id)).filter((item) => item !== undefined).map((item) =>
        <div key={item.id} className={`search-tab${item.id === state.activeSearchId ? " is-active" : ""}`}>
          <button className="tab-select" aria-pressed={item.id === state.activeSearchId} onClick={() => mutate({ type: "openSearch", id: item.id })}>{item.term} · {item.city.split(",")[0]}</button>
          <button className="tab-close" aria-label={`Fechar aba ${item.term}`} onClick={() => mutate({ type: "closeTab", id: item.id })}>×</button>
        </div>)}
      <button className="search-tab-new" onClick={onNewSearch}>＋ Abrir busca</button>
    </div>
    <div className="search-summary"><div className="search-title-wrap"><h2 className="search-title">{search.term}</h2><p className="search-meta">{search.city} · {search.demo ? "Dados demonstrativos" : "Consulta sob demanda"}</p></div>
      <span className="search-state"><span className="status-dot" />{portal.remote ? "Google Places sob demanda" : "Sem coleta externa"}</span></div>
    {portal.remote && !search.demo ? <CollectionPanel key={search.id} search={search} portal={portal} /> : null}
    <div className="metric-grid">
      <Metric label="Resultados nesta busca" value={count} note={search.demo ? "registros demonstrativos" : "registros no workspace"} icon="⌕" />
      <Metric label="Visíveis" value={count - hidden} note="disponíveis na lista" icon="◉" />
      <Metric label="Favoritos" value={search.placeIds.filter((id) => state.favorites.includes(id)).length} note="neste workspace" icon="☆" />
      <Metric label="Ocultos" value={hidden} note="reversíveis nesta busca" icon="⊘" />
    </div>
    <div className="view-toolbar">
      <div className="view-switch" role="group" aria-label="Exibição dos resultados">
        {(["map", "list"] as const).map((view) => <button key={view} className={state.mobileView === view ? "is-active" : ""}
          aria-pressed={state.mobileView === view} onClick={() => mutate({ type: "setFilter", filter: { name: "mobileView", value: view } })}>{view === "map" ? "Mapa" : "Lista"}</button>)}
      </div>
      <div className="filter-row">
        <input className="search-filter" type="search" aria-label="Filtrar resultados" placeholder="⌕ Filtrar por nome ou região"
          value={state.searchFilter} maxLength={200} onChange={(event) => mutate({ type: "setFilter", filter: { name: "searchFilter", value: event.target.value } })} />
        <select className="filter-select" aria-label="Visibilidade" value={state.visibility} onChange={(event) => {
          const value = event.target.value;
          if (isVisibility(value)) mutate({ type: "setFilter", filter: { name: "visibility", value } });
        }}><option value="visible">Visíveis</option><option value="hidden">Ocultos</option><option value="all">Todos</option></select>
        <button className="button button-quiet button-small" aria-pressed={state.favoriteOnly} onClick={() => mutate({ type: "setFilter", filter: { name: "favoriteOnly", value: !state.favoriteOnly } })}>☆ Favoritos</button>
      </div>
    </div>
    <div className={`results-layout mobile-${state.mobileView}`}>
      <section className="panel map-panel" aria-label="Mapa de estabelecimentos">
        <div className="panel-heading">
          <h2>Mapa</h2>
          <small>{located.length} {located.length === 1 ? "ponto" : "pontos"} com coordenadas</small>
        </div>
        {located.length > 0
          ? <MapView markers={mapMarkers} onSelect={onSelect} />
          : <div className="map-empty"><p>Nenhum estabelecimento com coordenadas nos filtros atuais.</p></div>}
      </section>
      <section className="panel list-panel" aria-label="Lista de resultados">
        <div className="panel-heading"><h2>Estabelecimentos</h2><small>{ids.length} de {count}</small></div>
        <div className="list-scroll"><PlaceList portal={portal} ids={ids} hiddenIds={search.hiddenIds} onSelect={onSelect} selectedId={selectedId} /></div>
      </section>
    </div>
    {ids.length > located.length && <p className="footer-note">{ids.length - located.length} resultado(s) sem coordenadas não aparecem no mapa.</p>}
  </>;
}

function isVisibility(value: string): value is Visibility {
  return value === "visible" || value === "hidden" || value === "all";
}
