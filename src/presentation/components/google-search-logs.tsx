"use client";
import { useEffect, useState } from "react";
import { googleSearchLogsResponseSchema, type GoogleSearchLog } from "../../domain/google-search-log";

const statuses = { pending: "Sem conclusão registrada", success: "Sucesso", failed: "Falha" };
const statusClasses = { pending: "badge-pending", success: "badge-done", failed: "badge-failed" };

export function GoogleSearchLogs() {
  const [logs, setLogs] = useState<GoogleSearchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const response = await fetch("/api/v1/collection/logs", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Não foi possível carregar os logs de consultas (HTTP ${response.status}).`);
        const parsed = googleSearchLogsResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Resposta inválida ao carregar os logs de consultas.");
        if (!controller.signal.aborted) setLogs(parsed.data.logs);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Não foi possível carregar os logs de consultas.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  return <section className="page-card" aria-label="Logs de consultas ao Google">
    <h2>Logs de consultas ao Google</h2>
    <p>As 100 consultas mais recentes deste workspace, incluindo cada página das coletas.
      Os logs não incluem chaves, tokens ou dados dos estabelecimentos retornados.</p>
    <p>Uma consulta sem conclusão registrada pode estar em andamento ou ter sido interrompida.
      A reserva da cota não confirma recebimento nem cobrança pelo Google.</p>
    <button className="button button-quiet button-small" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
      Atualizar logs
    </button>
    {loading ? <p role="status">Carregando logs de consultas…</p>
      : error ? <p role="alert" className="collection-error">{error}</p>
        : logs.length === 0 ? <p>Nenhuma consulta registrada.</p>
          : <div className="google-log-scroll" tabIndex={0} role="region" aria-label="Histórico de consultas">
            <table className="google-log-table">
              <caption>Consultas recentes ao Google Places</caption>
              <thead><tr>
                <th scope="col">Data e hora</th><th scope="col">Usuário</th><th scope="col">Busca</th>
                <th scope="col">Origem</th><th scope="col">Status</th><th scope="col">Resultados</th>
                <th scope="col">Duração</th><th scope="col">Erro</th>
              </tr></thead>
              <tbody>{logs.map((log) => <tr key={log.id}>
                <td><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString("pt-BR")}</time></td>
                <td>{log.actorName}</td>
                <td><strong>{log.term}</strong><br />{log.city}</td>
                <td>{log.source === "collection" ? "Coleta" : "Busca direta"}{log.continuation ? " (continuação)" : ""}</td>
                <td><span className={`collection-badge ${statusClasses[log.status]}`}>{statuses[log.status]}</span></td>
                <td>{log.resultCount ?? "—"}</td>
                <td>{log.durationMs !== undefined ? `${log.durationMs} ms` : "—"}</td>
                <td>{log.errorCode ?? "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>}
  </section>;
}
