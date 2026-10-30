"use client";
import { useEffect, useState } from "react";
import { googleSearchLogsResponseSchema, type GoogleSearchLog } from "../../domain/google-search-log";
import { googleSearchDetailsResponseSchema } from "../../domain/google-search-details";
import { z } from "zod";
import { Modal } from "./common";

const statuses = { pending: "Sem conclusão registrada", success: "Sucesso", failed: "Falha" };
const statusClasses = { pending: "badge-pending", success: "badge-done", failed: "badge-failed" };

function LogDetails({ log, onClose }: { log: GoogleSearchLog; onClose: () => void }) {
  const [details, setDetails] = useState<z.infer<typeof googleSearchDetailsResponseSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null);
    setError(null);
    async function load() {
      try {
        const response = await fetch(`/api/v1/collection/logs/${encodeURIComponent(log.id)}`, {
          cache: "no-store", signal: controller.signal
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const parsed = z.object({ error: z.string() }).safeParse(body);
          throw new Error(parsed.success ? parsed.data.error : `Falha HTTP ${response.status} ao carregar detalhes.`);
        }
        const parsed = googleSearchDetailsResponseSchema.safeParse(body);
        if (!parsed.success) throw new Error("Resposta inválida ao carregar detalhes da consulta.");
        if (!controller.signal.aborted) setDetails(parsed.data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar detalhes.");
      }
    }
    void load();
    return () => controller.abort();
  }, [log.id, revision]);

  return <Modal title="Request e response do Google" onClose={onClose} detail>
    <div className="modal-heading"><h2>Request e response do Google</h2>
      <button className="icon-button" aria-label="Fechar detalhes da consulta" onClick={onClose}>×</button></div>
    <p>{log.term} — {log.city}</p>
    <p>Chaves e tokens ocultos. Dados retornados pelo Google disponíveis por 30 dias.</p>
    {error ? <><p role="alert" className="collection-error">{error}</p>
      <button className="button button-quiet" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button></>
      : !details ? <p role="status">Carregando request e response…</p>
        : <>
          <p>Detalhes disponíveis até {new Date(details.expiresAt).toLocaleString("pt-BR")}.</p>
          <h3>Request enviado ao Google</h3>
          <pre className="google-log-json" aria-label="Request enviado ao Google">{JSON.stringify(details.request, null, 2)}</pre>
          <h3>Response recebido do Google</h3>
          {details.response ? <>
            <p>{details.response.httpStatus === null ? "Sem resposta HTTP do Google." : `HTTP ${details.response.httpStatus}`}</p>
            {details.response.truncated && <p role="alert">Corpo truncado por exceder o limite de 1 MiB para detalhes.</p>}
            <pre className="google-log-json" aria-label="Response recebido do Google">{JSON.stringify(details.response, null, 2)}</pre>
          </> : <p>A resposta ainda não foi registrada. A consulta pode estar em andamento ou ter sido interrompida.</p>}
        </>}
    <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Fechar</button></div>
  </Modal>;
}

export function GoogleSearchLogs() {
  const [logs, setLogs] = useState<GoogleSearchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<GoogleSearchLog | null>(null);

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
      Consulte os detalhes de request e response, incluindo estabelecimentos, por 30 dias.
      Chaves e tokens são ocultados.</p>
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
                <th scope="col">Duração</th><th scope="col">Erro</th><th scope="col">Detalhes</th>
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
                <td><button className="button button-quiet button-small" aria-label={`Ver request e response de ${log.term}`}
                  onClick={() => setSelected(log)}>Request / response</button></td>
              </tr>)}</tbody>
            </table>
          </div>}
    {selected && <LogDetails key={selected.id} log={selected} onClose={() => setSelected(null)} />}
  </section>;
}
