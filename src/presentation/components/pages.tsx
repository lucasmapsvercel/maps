import { useState } from "react";
import type { Portal } from "../use-portal";
import { EmptyState, Modal, Notice } from "./common";
import type { SavedSearch } from "../../domain/types";
import { PlaceList } from "./place-list";
import { CollectionSettings } from "./collection-settings";
import { GoogleSearchLogs } from "./google-search-logs";

export function SavedSearches({ portal }: { portal: Portal }) {
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);
  const [busy, setBusy] = useState(false);
  return <><div className="saved-list">{portal.state.searches.length ? portal.state.searches.map((search) =>
    <article className="saved-item" key={search.id}><span className="saved-symbol" aria-hidden="true">⌕</span>
      <span className="saved-copy"><strong>{search.term}</strong><small>{search.city} · {search.placeIds.length} {search.demo ? "resultados demonstrativos" : "resultados salvos"}</small></span>
      <button className="button button-quiet button-small" onClick={() => portal.mutate({ type: "openSearch", id: search.id })}>Abrir busca →</button>
      <button className="button button-quiet button-small" aria-label={`Excluir busca ${search.term}`} disabled={portal.pending > 0} onClick={() => setDeleting(search)}>Excluir</button>
    </article>) : <EmptyState title="Ainda não há buscas salvas">Crie sua primeira pesquisa.</EmptyState>}</div>
    {deleting && <Modal title="Excluir busca salva" onClose={() => { if (!busy) setDeleting(null); }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          if (await portal.mutate({ type: "deleteSearch", id: deleting.id }, "Busca excluída. Estabelecimentos e anotações foram preservados.")) setDeleting(null);
        } finally {
          setBusy(false);
        }
      }}>
        <h2>Excluir busca salva</h2>
        <p>Excluir a busca <strong>{deleting.term}</strong> em {deleting.city}?</p>
        <p>A busca e suas abas serão removidas para todos do workspace. Estabelecimentos, favoritos,
          comentários, ajustes, histórico de consultas e consumo da cota serão preservados.
          Esta ação não pode ser desfeita.</p>
        <Notice notice={portal.notice} />
        <div className="modal-actions">
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</button>
          <button type="submit" className="button button-primary" disabled={busy || portal.pending > 0}>{busy ? "Excluindo…" : "Confirmar exclusão"}</button>
        </div>
      </form>
    </Modal>}
  </>;
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
  return <>
    <section className="page-card"><h2>Estado deste portal</h2>
      <p>{remote ? "Portal autenticado com Google OAuth. Dados compartilhados no MongoDB; abas e filtros separados por usuário." : "Demonstração isolada para testes locais, com dados sintéticos."}</p>
      <div className="settings-grid">
        {[
          ["Consulta de estabelecimentos", "Limite de requisições por execução, descontadas da cota mensal compartilhada. Cada chamada solicita até 20 resultados e a coleta continua da página anterior até o Google não disponibilizar mais dados.", remote ? "Habilitado" : "Configuração obrigatória"],
          ["Mapa", "Pins Leaflet com coordenadas reais dos estabelecimentos coletados.", "OpenStreetMap"],
          ["Dados e armazenamento", remote ? "Buscas, comentários, favoritos e ajustes persistem no MongoDB. O navegador não é a fonte dos dados." : "Dados sintéticos neste navegador.", remote ? "MongoDB" : "Armazenamento local"],
          ["Acesso e segurança", remote ? "Google OAuth, e-mails verificados e lista de acesso definida pelo administrador." : "Somente demonstração.", remote ? "Autenticado" : "Teste isolado"]
        ].map(([title, description, status]) => <article className="setting-card" key={title}><h3>{title}</h3><p>{description}</p><span className="setting-status"><span className="status-dot" />{status}</span></article>)}
      </div>
    </section>
    {remote && (
      <section className="page-card">
        <h2>Configurações de coleta</h2>
        <p>Defina o comportamento da coleta automática de estabelecimentos via Google Places.</p>
        <div className="settings-grid">
          <CollectionSettings />
        </div>
      </section>
    )}
    {remote && <GoogleSearchLogs />}
  </>;
}
