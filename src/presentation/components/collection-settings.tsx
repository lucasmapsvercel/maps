"use client";
import { useEffect, useState } from "react";
import { z } from "zod";

const configSchema = z.object({ maxResultsPerSearch: z.number().int().min(1).max(500) });

export function CollectionSettings() {
  const [value, setValue] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/v1/collection/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const parsed = configSchema.safeParse(data);
        if (parsed.success) { setValue(parsed.data.maxResultsPerSearch); setInput(String(parsed.data.maxResultsPerSearch)); }
      })
      .catch(() => setStatus({ message: "Não foi possível carregar a configuração de coleta.", error: true }));
  }, []);

  async function handleSave() {
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setStatus({ message: "Informe um número inteiro entre 1 e 500.", error: true });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/collection/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxResultsPerSearch: n })
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Falha HTTP ${res.status}`);
      }
      setValue(n);
      setStatus({ message: `Limite atualizado para ${n} resultados por coleta.`, error: false });
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : "Erro ao salvar.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="setting-card" aria-label="Configuração de coleta">
      <h3>Resultados por coleta</h3>
      <p>
        Número máximo de estabelecimentos buscados no Google por coleta.
        Cada 20 resultados consome 1 chamada da cota mensal.
        {value !== null && <> Valor atual: <strong>{value}</strong> ({Math.ceil(value / 20)} chamadas).</>}
      </p>
      <div className="setting-form">
        <input
          className="text-input setting-input"
          type="number" min={1} max={500} step={20}
          value={input}
          aria-label="Resultados por coleta"
          onChange={(e) => setInput(e.target.value)}
          disabled={saving || value === null}
        />
        <button
          className="button button-primary button-small"
          onClick={handleSave}
          disabled={saving || value === null || input === String(value)}
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {status && (
        <p role={status.error ? "alert" : "status"} className={status.error ? "quota-error" : "setting-success"}>
          {status.message}
        </p>
      )}
    </article>
  );
}
