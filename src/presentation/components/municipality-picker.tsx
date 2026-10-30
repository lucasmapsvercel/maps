"use client";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import {
  filterMunicipalities, municipalitiesResponseSchema, municipalityLabel, type Municipality
} from "../../domain/municipality";

export function MunicipalityPicker({ value, onChange }: { value: Municipality | null; onChange: (value: Municipality | null) => void }) {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [backupDate, setBackupDate] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const matches = filterMunicipalities(municipalities, query);
  const suggestions = matches.slice(0, 30);
  const expanded = open && !value && query.trim().length >= 2 && !loading && !error;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch("/api/v1/municipalities", { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok) {
          const parsed = z.object({ error: z.string() }).safeParse(body);
          throw new Error(parsed.success ? parsed.data.error : "Não foi possível carregar os municípios.");
        }
        const parsed = municipalitiesResponseSchema.safeParse(body);
        if (!parsed.success) throw new Error("O catálogo de municípios está em formato inválido.");
        if (!controller.signal.aborted) {
          setMunicipalities(parsed.data.municipalities);
          setBackupDate(parsed.data.source === "backup" ? new Date(parsed.data.updatedAt).toLocaleDateString("pt-BR") : "");
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar os municípios.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  function select(municipality: Municipality) {
    onChange(municipality);
    setQuery(municipalityLabel(municipality));
    setOpen(false);
    setActive(-1);
  }

  return <div className="municipality-picker">
    <label className="field-label" htmlFor={id}>Município</label>
    <input id={id} className="text-input" role="combobox" autoComplete="off"
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`}
      aria-busy={loading}
      aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-help`} required maxLength={200} disabled={loading || Boolean(error)}
      value={query} placeholder={loading ? "Carregando…" : "Digite o município ou município e UF"}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onChange={(event) => {
        setQuery(event.target.value);
        onChange(null);
        setActive(-1);
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          setActive((index) => event.key === "ArrowDown" ? Math.min(index + 1, suggestions.length - 1) : Math.max(0, index - 1));
        }
        if (event.key === "Enter" && expanded) {
          event.preventDefault();
          if (active >= 0 && suggestions[active]) select(suggestions[active]);
        }
      }} />
    <small id={`${id}-help`}>Selecione uma opção do IBGE. Digitar o nome sem selecionar não confirma o município.</small>
    {loading && <p role="status">Carregando municípios…</p>}
    {!loading && !error && backupDate && <small>Base de municípios de {backupDate}.</small>}
    {error && <><p role="alert" className="collection-error">{error}</p>
      <button type="button" className="button button-quiet button-small" onClick={() => setRevision((value) => value + 1)}>Tentar carregar municípios novamente</button></>}
    {expanded && <>
      <ul className="municipality-options" id={`${id}-options`} role="listbox" aria-label="Municípios do IBGE">
        {suggestions.map((municipality, index) => <li key={municipality.ibgeCode} id={`${id}-option-${index}`}
          role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()}
          onClick={() => select(municipality)}>
          {municipalityLabel(municipality)} <small>{municipality.stateName}</small>
        </li>)}
      </ul>
      <p role="status">{matches.length === 0 ? "Nenhum município encontrado." : matches.length > 30
        ? "Exibindo 30 opções. Digite mais letras ou a UF para refinar." : `${matches.length} município(s) encontrado(s).`}</p>
    </>}
    {value && <p role="status">Selecionado: {municipalityLabel(value)} · Código IBGE {value.ibgeCode} · {value.country}</p>}
  </div>;
}
