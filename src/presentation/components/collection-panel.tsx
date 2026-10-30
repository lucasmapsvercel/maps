"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { SavedSearch } from "../../domain/types";
import type { Portal } from "../use-portal";

type JobStatus = "pending" | "running" | "done" | "failed";

interface JobInfo {
  id: string;
  status: JobStatus;
  importedCount?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

const jobSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "done", "failed"]),
  importedCount: z.number().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional()
});

export function CollectionPanel({ search, portal }: { search: SavedSearch; portal: Portal }) {
  const [confirmed, setConfirmed] = useState(false);
  const [activeJob, setActiveJob] = useState<JobInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          if (job.status === "done") await portal.forceRefresh();
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
      setConfirmed(false);
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
    setConfirmed(false);
  }

  return (
    <section className="page-card" aria-label="Coleta de estabelecimentos">
      <h2>Coletar estabelecimentos</h2>
      <p>
        Uma chamada à API Google Places por coleta, até 20 resultados por busca.
        Os estabelecimentos são salvos automaticamente no workspace e ficam disponíveis
        no mapa e na lista sem nova chamada à API.
      </p>

      {!activeJob && (
        <>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={starting}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            Confirmo uma nova chamada à API Google, sujeita à franquia e ao limite configurado.
          </label>
          <div className="modal-actions">
            <button
              className="button button-primary"
              disabled={!confirmed || starting}
              onClick={handleStart}
            >
              {starting ? "Iniciando coleta…" : "Coletar estabelecimentos"}
            </button>
          </div>
        </>
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
                Falha na coleta: {activeJob.error}
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

      <p className="footer-note">
        <a href="/terms" target="_blank" rel="noopener noreferrer">Termos de uso</a>
        {" · "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacidade</a>
      </p>
    </section>
  );
}
