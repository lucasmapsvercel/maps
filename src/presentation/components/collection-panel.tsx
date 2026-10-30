"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { SavedSearch } from "../../domain/types";
import type { Portal } from "../use-portal";
import { collectionJobSchema, type CollectionJobInfo } from "../../domain/collection-job";
import { collectionCoverageSchema, type CollectionCoverage } from "../../domain/collection-coverage";
import {
  collectionQuotaSchema, DEFAULT_COLLECTION_REQUESTS, GOOGLE_TEXT_SEARCH_PAGE_SIZE, type CollectionQuota
} from "../../domain/collection-config";

export function CollectionPanel({ search, portal }: { search: SavedSearch; portal: Portal }) {
  const [quota, setQuota] = useState<CollectionQuota | null>(null);
  const [quotaError, setQuotaError] = useState("");
  const [activeJob, setActiveJob] = useState<CollectionJobInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [coverage, setCoverage] = useState<CollectionCoverage | null>(null);
  const pollingJobId = activeJob?.status === "pending" || activeJob?.status === "running" ? activeJob.id : null;

  const fetchQuota = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/v1/collection/quota", { cache: "no-store", signal });
      if (!res.ok) throw new Error("Não foi possível carregar a cota.");
      const data = collectionQuotaSchema.parse(await res.json());
      if (!signal?.aborted) { setQuota(data); setQuotaError(""); }
    } catch { if (!signal?.aborted) setQuotaError("Não foi possível carregar a cota."); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchQuota(controller.signal);
    return () => controller.abort();
  }, [fetchQuota]);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryFailed(false);
    setActiveJob(null);
    setCoverage(null);
    setError("");
    async function loadHistory() {
      try {
        const res = await fetch(`/api/v1/collection/run?searchId=${encodeURIComponent(search.id)}`, {
          cache: "no-store", signal: controller.signal
        });
        if (!res.ok) throw new Error("Não foi possível carregar o progresso da coleta.");
        const jobs = z.array(collectionJobSchema).parse(await res.json());
        let plan = jobs[0]?.coverage;
        if (!plan) {
          const response = await fetch(`/api/v1/collection/plan?searchId=${encodeURIComponent(search.id)}`, {
            cache: "no-store", signal: controller.signal
          });
          if (!response.ok) throw new Error("Não foi possível carregar o plano da coleta.");
          plan = collectionCoverageSchema.parse(await response.json());
        }
        if (!controller.signal.aborted) {
          setActiveJob(jobs[0] ?? null);
          setCoverage(plan);
        }
      } catch {
        if (!controller.signal.aborted) {
          setHistoryFailed(true);
          setError("Não foi possível carregar o progresso da coleta. Reabra a busca para tentar novamente.");
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [search.id]);

  useEffect(() => {
    if (!pollingJobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let displayedCount = 0;
    async function poll() {
      let finished = false;
      try {
        const res = await fetch(`/api/v1/collection/run/${pollingJobId}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error("Não foi possível atualizar o progresso da coleta.");
        const job = collectionJobSchema.parse(await res.json());
        if (controller.signal.aborted) return;
        const terminal = job.status === "done" || job.status === "failed";
        const collected = job.collectedSoFar ?? 0;
        if (terminal || collected > displayedCount) {
          await portal.forceRefresh();
          await fetchQuota(controller.signal);
          displayedCount = collected;
        }
        if (!controller.signal.aborted) {
          setError("");
          setActiveJob(job);
          finished = terminal;
        }
      } catch {
        if (!controller.signal.aborted) setError("Não foi possível atualizar o progresso da coleta. Tentaremos novamente; não inicie outra consulta.");
      } finally {
        if (!finished && !controller.signal.aborted) timer = setTimeout(poll, 2500);
      }
    }
    timer = setTimeout(poll, 2500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pollingJobId, portal.forceRefresh, fetchQuota]);

  async function handleStart() {
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/v1/collection/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId: search.id, confirmed: true })
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(body);
        throw new Error(parsed.success ? parsed.data.error : `Falha HTTP ${res.status}.`);
      }
      const parsed = z.object({ jobId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) throw new Error("O servidor retornou uma confirmação de coleta inválida. Reabra a busca para verificar o progresso.");
      setActiveJob({ id: parsed.data.jobId, status: "pending", ...(coverage ? { coverage } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar a coleta.");
    } finally {
      setStarting(false);
    }
  }

  const alreadyCollected = search.placeIds.length;
  const limit = quota?.maxRequestsPerRun ?? DEFAULT_COLLECTION_REQUESTS;
  const exhausted = activeJob?.status === "done" && activeJob.hasMore === false;
  const running = pollingJobId !== null;
  const quotaOk = quota && quota.remaining > 0;
  const canStart = quota !== null && !exhausted && !running && !starting && !historyLoading && !historyFailed;

  const usedPct = quota?.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  const progress = activeJob?.coverage ?? coverage;

  return (
    <section className="page-card" aria-label="Coleta de estabelecimentos">
      <h2>Coletar estabelecimentos</h2>
      {historyLoading ? <p role="status">Carregando plano da coleta…</p> : progress && (
        <div aria-label="Abrangência da coleta">
          {progress.mode === "neighborhoods" ? <>
            <p>Consulta automática a todos os {progress.total} bairros disponíveis. Base IBGE: {progress.catalogDate}.</p>
            <p>{progress.completed} de {progress.total} bairros concluídos.
              {progress.current && <> {running ? "Consultando" : "Próximo bairro"}: {progress.current} — bairro {progress.completed + 1} de {progress.total}.</>}
            </p>
            <p>O limite de {limit} requisições é compartilhado entre todos os bairros, não por bairro.
              Os resultados podem incluir locais próximos e não garantem cobertura completa.</p>
          </> : <p>{progress.reason === "legacy_cursor"
            ? "Esta busca mantém a consulta municipal anterior para evitar repetições. Crie uma nova busca para consultar automaticamente os bairros disponíveis."
            : "Divisão por bairros indisponível. A consulta será feita para o município inteiro."}</p>}
        </div>
      )}

      <div className={`collection-state ${exhausted ? "state-full" : "state-partial"}`}>
        <div>
          <strong>{alreadyCollected} estabelecimentos coletados</strong>
          <p>{exhausted ? "O Google não disponibilizou mais resultados. Nenhuma nova chamada será feita."
            : `Cada execução realiza até ${limit} requisições, continuando de onde a anterior parou. Cada requisição solicita até ${GOOGLE_TEXT_SEARCH_PAGE_SIZE} resultados; ${progress?.mode === "neighborhoods"
              ? "ao terminar as páginas de um bairro, a coleta segue para o próximo, até concluir o plano ou atingir o limite."
              : "a coleta para quando não houver mais páginas."}`}</p>
        </div>
      </div>

      <div className="quota-panel" aria-label="Cota mensal de API">
        {quotaError ? (
          <p className="quota-error">{quotaError}</p>
        ) : quota ? (
          <>
            <div className="quota-row">
              <span className="quota-label">Cota mensal ({quota.month})</span>
              <span className="quota-numbers">
                <strong>{quota.remaining.toLocaleString("pt-BR")}</strong>
                {" "}disponíveis de{" "}
                <strong>{quota.limit.toLocaleString("pt-BR")}</strong>
              </span>
            </div>
            <div className="quota-bar" role="progressbar" aria-valuenow={quota.used} aria-valuemin={0} aria-valuemax={quota.limit}>
              <div className="quota-bar-fill" style={{ width: `${usedPct}%` }} />
            </div>
            {!exhausted && (
              <p className="quota-detail">
                Limite desta execução:{" "}
                <strong>{quota.maxRequestsPerRun} requisições</strong>.
                {" "}Apenas chamadas realizadas consomem a cota mensal.
                Há {Math.min(quota.maxRequestsPerRun, quota.remaining)} chamadas disponíveis para esta execução.
                A quantidade de resultados depende das páginas disponibilizadas pelo Google.
                {!quotaOk && <span className="quota-warning"> Sem cota para novas chamadas. Itens pendentes já recebidos ainda podem ser importados.</span>}
              </p>
            )}
          </>
        ) : (
          <p className="quota-loading">Carregando cota…</p>
        )}
      </div>

      {!exhausted && !running && (
        <div className="modal-actions">
          <button className="button button-primary" disabled={!canStart} onClick={handleStart}>
            {historyLoading ? "Carregando progresso…" : starting ? "Iniciando coleta…" : alreadyCollected > 0 ? "Continuar coleta" : "Coletar estabelecimentos"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="collection-error">{error}</p>}

      {activeJob && (
        <div className="collection-status" role="status" aria-live="polite">
          {activeJob.status === "pending" && <span className="collection-badge badge-pending">Aguardando início…</span>}
          {activeJob.status === "running" && <span className="collection-badge badge-running">
            Coletando estabelecimentos… {activeJob.requestsMade ?? 0} requisição(ões) de até {activeJob.maxRequestsPerRun ?? limit}.
            {" "}{activeJob.collectedSoFar ?? 0} estabelecimento(s) importado(s) nesta execução.
          </span>}
          {activeJob.status === "done" && (
            <>
              <span className="collection-badge badge-done">
                Coleta concluída — {activeJob.importedCount ?? 0} estabelecimento(s) importado(s).
                {activeJob.requestsMade !== undefined && <> {activeJob.requestsMade} requisição(ões) realizada(s).</>}
              </span>
            </>
          )}
          {activeJob.status === "failed" && (
            <>
              <span className="collection-badge badge-failed" role="alert">Falha: {activeJob.error}</span>
              {activeJob.requestsMade !== undefined && <p>{activeJob.requestsMade} requisição(ões) contabilizada(s) nesta execução.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
