import type { Portal } from "../use-portal";
import { EmptyState } from "./common";

export function PlaceList({ portal, ids, hiddenIds = [], onSelect, selectedId }: {
  portal: Portal; ids: string[]; hiddenIds?: string[]; onSelect: (id: string) => void; selectedId: string | null;
}) {
  if (!ids.length) return <EmptyState title="Nenhum resultado neste filtro">Altere os filtros ou consulte os itens ocultos.</EmptyState>;
  return ids.map((id) => {
    const place = portal.service.getPlace(id);
    const favorite = portal.state.favorites.includes(id);
    return <article className={`place-row${selectedId === id ? " is-selected" : ""}`} key={id}>
      <button className="place-open" aria-label={`Ver detalhes de ${place.name}`} onClick={() => onSelect(id)}>
        <span className="place-avatar" aria-hidden="true">{place.name.slice(0, 1).toUpperCase()}</span>
        <span className="place-copy"><strong>{place.name}</strong><small>{place.address}</small>
          <span className="place-category">{place.category}{hiddenIds.includes(id) ? " · oculto" : ""}</span>
        </span>
      </button>
      <span className="place-actions"><button className={`mini-action${favorite ? " is-favorite" : ""}`}
        aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-pressed={favorite}
        disabled={portal.pending > 0} onClick={() => portal.mutate({ type: "toggleFavorite", id })}>☆</button></span>
    </article>;
  });
}
