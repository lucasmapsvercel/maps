import { useEffect, useRef } from "react";
import type { Portal } from "../use-portal";
import { EmptyState } from "./common";

export function PlaceList({ portal, ids, hiddenIds = [], onSelect, selectedId }: {
  portal: Portal; ids: string[]; hiddenIds?: string[]; onSelect: (id: string) => void; selectedId: string | null;
}) {
  const selectedRow = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = selectedRow.current;
    const list = row?.closest(".list-scroll");
    if (!row || !list) return;
    const bounds = list.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom) {
      list.scrollTo({ top: list.scrollTop + item.top - bounds.top, behavior: "smooth" });
    }
  }, [selectedId, ids]);
  if (!ids.length) return <EmptyState title="Nenhum resultado neste filtro">Altere os filtros ou consulte os itens ocultos.</EmptyState>;
  return ids.map((id) => {
    const place = portal.service.getPlace(id);
    const favorite = portal.state.favorites.includes(id);
    return <article ref={selectedId === id ? selectedRow : undefined} className={`place-row${selectedId === id ? " is-selected" : ""}`} key={id}>
      <button className="place-open" aria-pressed={selectedId === id} aria-label={`Ver detalhes de ${place.name}`} onClick={() => onSelect(id)}>
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
