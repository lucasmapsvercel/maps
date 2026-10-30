import { useState } from "react";
import type { Portal } from "../use-portal";
import { Modal, Notice } from "./common";
import { MunicipalityPicker } from "./municipality-picker";
import { municipalityCity, type Municipality } from "../../domain/municipality";

export function SearchDialog({ portal, onClose }: { portal: Portal; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [selectionError, setSelectionError] = useState("");
  return <Modal title="Criar uma busca" onClose={onClose}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!municipality) { setSelectionError("Selecione um município válido da lista do IBGE."); return; }
      if (await portal.mutate({ type: "addSearch", term, city: municipalityCity(municipality), municipality }, "Busca salva. Nenhuma consulta externa foi iniciada.")) onClose();
    }}>
      <div className="modal-heading"><div><span className="eyebrow">NOVA PESQUISA</span><h2>Criar uma busca</h2></div>
        <button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>×</button></div>
      <p className="modal-intro">Defina o que procura e onde. Nenhuma coleta externa será iniciada.</p>
      <label className="field-label" htmlFor="search-term">Termo de pesquisa</label>
      <input id="search-term" className="text-input" minLength={2} maxLength={200} required autoFocus value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Ex.: Aparelho auditivo" />
      <MunicipalityPicker value={municipality} onChange={(value) => { setMunicipality(value); setSelectionError(""); }} />
      {selectionError && <p role="alert" className="collection-error">{selectionError}</p>}
      <div className="inline-note">Salvar não consulta o Google. A consulta é confirmada separadamente no dashboard.</div>
      <Notice notice={portal.notice} />
      <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancelar</button>
        <button className="button button-primary" type="submit" disabled={portal.pending > 0 || !municipality}>Salvar busca →</button></div>
    </form>
  </Modal>;
}
