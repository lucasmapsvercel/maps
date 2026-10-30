import { useState } from "react";
import type { Portal } from "../use-portal";
import { Notice } from "./common";

function formatDate(value: string) {
  return Number.isNaN(Date.parse(value)) ? "sem data" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

export function PlaceDetails({ portal, id, onClose }: { portal: Portal; id: string; onClose: () => void }) {
  const { state, service, mutate } = portal;
  const place = service.getPlace(id);
  const search = service.searchForPlace(id);
  const favorite = state.favorites.includes(id);
  const comments = state.comments[id] || [];
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(place.phone || "");
  const [website, setWebsite] = useState(place.website || "");
  const [comment, setComment] = useState("");
  return <section className="panel place-details" aria-label={`Detalhes de ${place.name}`}>
    <div className="detail-header"><div><span className="eyebrow">DETALHE DO REGISTRO</span><h2 className="detail-title">{place.name}</h2><p className="detail-address">{place.address}</p></div>
      <div className="detail-actions"><button className={`mini-action${favorite ? " is-favorite" : ""}`} aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
        aria-pressed={favorite} disabled={portal.pending > 0} onClick={() => mutate({ type: "toggleFavorite", id })}>☆</button>
        <button className="icon-button" aria-label="Fechar detalhes" onClick={onClose}>×</button></div>
    </div>
    <div className="detail-fields">
      {[["CATEGORIA", place.category], ["TELEFONE", place.phone], ["WEBSITE", place.website], ["COORDENADAS", "Não disponíveis neste conjunto demonstrativo"]].map(([label, value]) =>
        <div className="detail-field" key={label}><span>{label}</span><strong>{value || "Não informado"}</strong></div>)}
    </div>
    <div className="detail-section-title"><span>Dados locais</span>
      {!!Object.keys(state.overrides[id] || {}).length && <button className="button button-quiet button-small" onClick={() => mutate({ type: "clearOverrides", id }, "Os ajustes locais foram removidos.")}>Remover ajustes</button>}
    </div>
    {editing ? <form className="edit-form" onSubmit={async (event) => {
      event.preventDefault();
      if (await mutate({ type: "editPlace", id, phone, website }, "Ajustes locais salvos.")) setEditing(false);
    }}>
      <label className="field-label" htmlFor="edit-phone">Telefone</label><label className="field-label" htmlFor="edit-website">Website</label>
      <input id="edit-phone" className="text-input" maxLength={60} value={phone} onChange={(event) => setPhone(event.target.value)} />
      <input id="edit-website" className="text-input" maxLength={200} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://" />
      <div className="form-actions"><button className="button button-quiet button-small" type="button" onClick={() => setEditing(false)}>Cancelar</button>
        <button className="button button-primary button-small" type="submit" disabled={portal.pending > 0}>Salvar dados locais</button></div>
    </form> : <><p className="footer-note">Ajustes internos ficam separados dos dados originais do registro.</p>
      <div className="modal-actions"><button className="button button-quiet button-small" onClick={() => { setPhone(place.phone || ""); setWebsite(place.website || ""); setEditing(true); }}>✎ Editar dados locais</button>
        {search && <button className="button button-quiet button-small" disabled={portal.pending > 0} onClick={() => mutate({ type: "toggleHidden", id })}>{search.hiddenIds.includes(id) ? "Restaurar nesta busca" : "Ocultar nesta busca"}</button>}</div></>}
    <div className="detail-section-title"><span>Comentários internos</span><span>{comments.length}</span></div>
    <div className="comment-list">{comments.map((item, index) => <div className="comment-item" key={`${item.createdAt}-${index}`}>{item.text}<small>{item.authorName || "Demo MAPS"} · {formatDate(item.createdAt)}</small></div>)}
      {!comments.length && <p className="footer-note">Nenhum comentário adicionado.</p>}</div>
    <form className="comment-form" onSubmit={async (event) => {
      event.preventDefault();
      if (await mutate({ type: "addComment", id, text: comment }, portal.remote ? "Comentário salvo no MongoDB." : "Comentário salvo neste navegador.")) setComment("");
    }}>
      <input className="text-input" maxLength={500} required value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Escreva um comentário interno..." aria-label="Novo comentário" />
      <button className="button button-primary button-small" type="submit" disabled={portal.pending > 0}>Adicionar</button>
    </form>
    <p className="footer-note">{portal.remote ? "Dados internos do workspace. Não inclua dados pessoais sensíveis nos comentários." : "Dados de exemplo, sem localização ou informações comerciais reais."}</p>
    <Notice notice={portal.notice} />
  </section>;
}
