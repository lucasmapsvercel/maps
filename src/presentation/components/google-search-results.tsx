import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { googleSearchResultSchema, type GoogleSearchResult } from "../../domain/google-search";
import type { SavedSearch } from "../../domain/types";

export function GoogleSearchResults({ search }: { search: SavedSearch }) {
  const [result, setResult] = useState<GoogleSearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => {
      setResult(null);
      setError("A sessão de consulta expirou. Confirme uma nova consulta para obter resultados atualizados.");
    }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);
  const places = (result?.places || []).filter((place) =>
    `${place.name} ${place.address}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  return <section className="page-card" aria-label="Consulta Google Places">
    <h2>Consultar estabelecimentos no Google</h2>
    <p>Uma chamada por consulta, até 20 resultados. A cidade compõe o texto da pesquisa;
      não há garantia de pertencimento ao limite municipal ou cobertura completa.</p>
    <p>Sem mapa pago, telefone ou site. Os resultados aparecem somente nesta sessão e
      não são salvos no banco nem restaurados ao reabrir a busca.</p>
    <label><input type="checkbox" checked={confirmed} disabled={pending}
      onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo uma nova chamada à API Google, sujeita à franquia e ao limite configurado.</label>
    <div className="modal-actions"><button className="button button-primary" disabled={!confirmed || pending}
      onClick={async () => {
        setPending(true);
        setConfirmed(false);
        setError("");
        setResult(null);
        const abort = new AbortController();
        controller.current = abort;
        try {
          const response = await fetch("/api/v1/collection", {
            method: "POST", cache: "no-store", signal: abort.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchId: search.id, requestId: crypto.randomUUID(), confirmed: true })
          });
          const body: unknown = await response.json();
          if (!response.ok) {
            const failure = z.object({ error: z.string() }).safeParse(body);
            throw new Error(failure.success ? failure.data.error : `Falha HTTP ${response.status}.`);
          }
          setResult(googleSearchResultSchema.parse(body));
        } catch (failure) {
          if (!abort.signal.aborted) setError(failure instanceof Error
            ? failure.message : "Não foi possível consultar. A tentativa pode ter sido contabilizada.");
        } finally {
          if (!abort.signal.aborted) setPending(false);
        }
      }}>{pending ? "Consultando Google..." : "Consultar Google Places"}</button></div>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <div className="panel-heading"><h3>Resultados do Google Maps</h3><span>{places.length} de {result.places.length}</span></div>
      <p className="google-attribution">Google Maps</p>
      <input className="text-input" type="search" aria-label="Filtrar resultados Google" maxLength={200}
        placeholder="Filtrar sem nova consulta" value={query} onChange={(event) => setQuery(event.target.value)} />
      {places.map((place) => <article className="place-row" key={place.id}>
        <div><h3>{place.name}</h3><p>{place.address}</p>
          {place.attributions.map((attribution, index) => <small key={`${attribution.provider}-${index}`}>
            {attribution.providerUri ? <a href={attribution.providerUri} target="_blank" rel="noopener noreferrer">{attribution.provider}</a> : attribution.provider}
          </small>)}
        </div>
      </article>)}
      {!places.length && <p>Nenhum resultado para esta consulta ou filtro.</p>}
      {result.limited && <p>Resultados limitados; páginas adicionais não são consultadas automaticamente.</p>}
    </>}
    <p className="footer-note"><a href="/terms" target="_blank" rel="noopener noreferrer">Termos de uso</a>
      {" · "}<a href="/privacy" target="_blank" rel="noopener noreferrer">Privacidade</a></p>
  </section>;
}
