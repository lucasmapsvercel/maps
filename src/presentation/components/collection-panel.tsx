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
}

interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  month: string;
  maxResultsPerSearch: number;
  callsPerSearch: number;
}

const jobSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "done", "failed"]),
  importedCount: z.number().optional(),
  error: z.string().optional()
});

const quotaSchema = z.object({
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  month: z.string(),
  maxResultsPerSearch: z.number(),
  callsPerSearch: z.number()
});

export function CollectionPanel({ search, portal }: { search: SavedSearch; portal: Portal }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaError, setQuotaError] = useState("");
  const [activeJob, setActiveJob] = useState<JobInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/collection/run/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = jobSchema.safeParse(await res.json());
        if (!data.success) return;
        const job = data.data;
        setActiveJob(job);
        if (job.status === "done" || job.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          if (job.status === "done") {
            await portal.forceRefresh();
            await fetchQuota();
          }
        }
      } catch { /* ignorar erros transitórios de rede */ }
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

  function handleRetry() {
    setActiveJob(null);
    setError("");
    void fetchQuota();
  }

  const canStart = quota && quota.remaining >= quota.callsPerSearch && !activeJob && !starting;
  const usedPct = quota ? Math.min(100, (quota.used / quota.limit) * 100) : 0;

  return (
    <section className="page-card" aria-label="Coleta de estabelecimentos">
      <h2>Coletar estabelecimentos</h2>

      {/* Painel de cota */}
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
            <p className="quota-detail">
              Esta coleta buscará até{" "}
              <strong>{quota.maxResultsPerSearch} estabelecimentos</strong>
              {" "}consumindo{" "}
              <strong>{quota.callsPerSearch} {quota.callsPerSearch === 1 ? "chamada" : "chamadas"}</strong>
              {" "}da cota.
              {quota.remaining < quota.callsPerSearch && (
                <span className="quota-warning"> Cota insuficiente para esta coleta.</span>
              )}
            </p>
          </>
        ) : (
          <p className="quota-loading">Carregando cota…</p>
        )}
      </div>

      {/* Estado do job */}
      {!activeJob && (
        <div className="modal-actions">
          <button
            className="button button-primary"
            disabled={!canStart}
            onClick={handleStart}
          >
            {starting ? "Iniciando coleta…" : "Coletar estabelecimentos"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="collection-error">{error}</p>}

      {activeJob && (
        <div className="collection-status" role="status" aria-live="polite">
          {activeJob.status === "pending" && (
            <span className="collection-badge badge-pending">Aguardando início…</span>
          )}
          {activeJob.status === "running" && (
            <span className="collection-badge badge-running">Coletando estabelecimentos…</span>
          )}
          {activeJob.status === "done" && (
            <>
              <span className="collection-badge badge-done">
                Coleta concluída — {activeJob.importedCount ?? 0} estabelecimento(s) importado(s).
              </span>
              <div className="modal-actions">
                <button className="button button-quiet" onClick={handleRetry}>
                  Nova coleta
                </button>
              </div>
            </>
          )}
          {activeJob.status === "failed" && (
            <>
              <span className="collection-badge badge-failed" role="alert">
                Falha: {activeJob.error}
              </span>
              <div className="modal-actions">
                <button className="button button-quiet" onClick={handleRetry}>
                  Tentar novamente
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
