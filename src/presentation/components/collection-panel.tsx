"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { SavedSearch } from "../../domain/types";
import type { Portal } from "../use-portal";

type JobStatus = "pending" | "running" | "done" | "failed";

interface JobInfo {
  id: string;
  status: JobStatus;
  importedCount?: number;
  error?: string;
  hasMore?: boolean;
  requestsMade?: number;
  maxRequestsPerRun?: number;
}

interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  month: string;
  maxRequestsPerRun: number;
  resultsPerRequest: number;
}

const jobSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "done", "failed"]),
  importedCount: z.number().optional(),
  error: z.string().optional(),
  hasMore: z.boolean().optional(),
  requestsMade: z.number().int().nonnegative().optional(),
  maxRequestsPerRun: z.number().int().positive().optional()
});

const quotaSchema = z.object({
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  month: z.string(),
  maxRequestsPerRun: z.number().int().positive(),
  resultsPerRequest: z.number().int().positive()
});

export function CollectionPanel({ search, portal }: { search: SavedSearch; portal: Portal }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaError, setQuotaError] = useState("");
  const [activeJob, setActiveJob] = useState<JobInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/collection/quota", { cache: "no-store" });
      if (!res.ok) { setQuotaError("Não foi possível carregar a cota."); return; }
      const data = quotaSchema.safeParse(await res.json());
      if (data.success) { setQuota(data.data); setQuotaError(""); }
      else setQuotaError("Resposta de cota inválida.");
    } catch { setQuotaError("Não foi possível carregar a cota."); }
  }, []);

  useEffect(() => { void fetchQuota(); }, [fetchQuota]);
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await fetch(`/api/v1/collection/run?searchId=${encodeURIComponent(search.id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Não foi possível carregar o progresso da coleta.");
        const jobs = z.array(jobSchema).parse(await res.json());
        if (cancelled) return;
        const latest = jobs[0] ?? null;
        setActiveJob(latest);
        if (latest?.status === "pending" || latest?.status === "running") startPolling(latest.id);
      } catch {
        if (!cancelled) {
          setHistoryFailed(true);
          setError("Não foi possível carregar o progresso da coleta. Reabra a busca para tentar novamente.");
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [search.id]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/collection/run/${jobId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Não foi possível atualizar o progresso da coleta.");
        const data = jobSchema.safeParse(await res.json());
        if (!data.success) throw new Error("Resposta de progresso inválida.");
        setError("");
        const job = data.data;
        setActiveJob(job);
        if (job.status === "done" || job.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          await portal.forceRefresh();
          await fetchQuota();
        }
      } catch {
        setError("Não foi possível atualizar o progresso da coleta. Tentaremos novamente; não inicie outra consulta.");
      }
    }, 2500);
  }

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
      const { jobId } = body as { jobId: string };
      setActiveJob({ id: jobId, status: "pending" });
      startPolling(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar a coleta.");
    } finally {
      setStarting(false);
    }
  }

  const alreadyCollected = search.placeIds.length;
  const limit = quota?.maxRequestsPerRun ?? 100;
  const exhausted = activeJob?.status === "done" && activeJob.hasMore === false;
  const running = activeJob?.status === "pending" || activeJob?.status === "running";
  const quotaOk = quota && quota.remaining > 0;
  const canStart = quota !== null && !exhausted && !running && !starting && !historyLoading && !historyFailed;

  const usedPct = quota ? Math.min(100, (quota.used / quota.limit) * 100) : 0;

  return (
    <section className="page-card" aria-label="Coleta de estabelecimentos">
      <h2>Coletar estabelecimentos</h2>

      <div className={`collection-state ${exhausted ? "state-full" : "state-partial"}`}>
        <div>
          <strong>{alreadyCollected} estabelecimentos coletados</strong>
          <p>{exhausted ? "O Google não disponibilizou mais resultados. Nenhuma nova chamada será feita."
            : `Cada execução realiza até ${limit} requisições, continuando de onde a anterior parou. Cada requisição solicita até ${quota?.resultsPerRequest ?? 20} resultados; a coleta para quando não houver mais páginas.`}</p>
        </div>
      </div>

      {/* Painel de cota mensal */}
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

      {/* Botão de ação */}
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
