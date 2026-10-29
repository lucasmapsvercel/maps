import type { Portal } from "../use-portal";
import { EmptyState } from "./common";
import { PlaceList } from "./place-list";

export function SavedSearches({ portal }: { portal: Portal }) {
  return <div className="saved-list">{portal.state.searches.length ? portal.state.searches.map((search) =>
    <article className="saved-item" key={search.id}><span className="saved-symbol" aria-hidden="true">⌕</span>
      <span className="saved-copy"><strong>{search.term}</strong><small>{search.city} · {search.placeIds.length} resultados {search.demo ? "demonstrativos" : "· sem coleta"}</small></span>
      <button className="button button-quiet button-small" onClick={() => portal.mutate({ type: "openSearch", id: search.id })}>Abrir busca →</button>
    </article>) : <EmptyState title="Ainda não há buscas salvas">Crie sua primeira pesquisa.</EmptyState>}</div>;
}

export function Favorites({ portal, onSelect, selectedId }: {
  portal: Portal; onSelect: (id: string) => void; selectedId: string | null;
}) {
  const ids = portal.state.favorites.filter((id) => portal.state.places[id]);
  return <section className="panel list-panel"><div className="panel-heading"><h2>Estabelecimentos favoritados</h2><small>{ids.length} registros</small></div>
    <div className="list-scroll">{ids.length ? <PlaceList portal={portal} ids={ids} onSelect={onSelect} selectedId={selectedId} /> :
      <EmptyState title="Nenhum favorito por enquanto">Use a estrela ao lado de um resultado para guardá-lo aqui.</EmptyState>}</div></section>;
}

export function Settings({ remote = false }: { remote?: boolean }) {
  return <section className="page-card"><h2>Estado deste portal</h2>
    <p>{remote ? "Portal autenticado com Google OAuth. Dados compartilhados no MongoDB; abas e filtros separados por usuário." : "Demonstração isolada para testes locais, com dados sintéticos."}</p>
    <div className="settings-grid">
      {[
        ["Coleta de estabelecimentos", "Defina fonte autorizada, retenção e limites antes da integração. Não há worker de coleta real configurado.", "Bloqueada"],
        ["Mapa", "Visualização ilustrativa, sem Google Maps nem coordenadas reais.", "Integração não configurada"],
        ["Dados e armazenamento", remote ? "Buscas, comentários, favoritos e ajustes persistem no MongoDB. O navegador não é a fonte dos dados." : "Dados sintéticos neste navegador.", remote ? "MongoDB" : "Armazenamento local"],
        ["Acesso e segurança", remote ? "Google OAuth, e-mails verificados e lista de acesso definida pelo administrador." : "Somente demonstração.", remote ? "Autenticado" : "Teste isolado"]
      ].map(([title, description, status]) => <article className="setting-card" key={title}><h3>{title}</h3><p>{description}</p><span className="setting-status"><span className="status-dot" />{status}</span></article>)}
    </div>
  </section>;
}
