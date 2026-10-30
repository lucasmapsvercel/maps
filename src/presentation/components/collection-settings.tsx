"use client";
import { useEffect, useState } from "react";
import { collectionConfigSchema, GOOGLE_TEXT_SEARCH_PAGE_SIZE, MAX_COLLECTION_REQUESTS } from "../../domain/collection-config";

export function CollectionSettings() {
  const [value, setValue] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/v1/collection/config", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar configuração.");
        return r.json();
      })
      .then((data) => {
        const parsed = collectionConfigSchema.parse(data);
        setValue(parsed.maxRequestsPerRun);
        setInput(String(parsed.maxRequestsPerRun));
      })
      .catch(() => setStatus({ message: "Não foi possível carregar a configuração de coleta.", error: true }));
  }, []);

  async function handleSave() {
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > MAX_COLLECTION_REQUESTS) {
      setStatus({ message: `Informe um número inteiro entre 1 e ${MAX_COLLECTION_REQUESTS}.`, error: true });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/collection/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxRequestsPerRun: n })
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Falha HTTP ${res.status}`);
      }
      const saved = collectionConfigSchema.parse(await res.json());
      setValue(saved.maxRequestsPerRun);
      setInput(String(saved.maxRequestsPerRun));
      setStatus({ message: `Limite atualizado para ${saved.maxRequestsPerRun} requisições por execução.`, error: false });
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : "Erro ao salvar.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="setting-card" aria-label="Configuração de coleta">
      <h3>Requisições por execução</h3>
      <p>
        Número máximo de requisições ao Google em cada execução de coleta.
        Cada requisição solicita o máximo permitido: {GOOGLE_TEXT_SEARCH_PAGE_SIZE} resultados.
        As chamadas realizadas são descontadas da cota mensal do sistema (até 5.000).
        A coleta para antes se acabarem as páginas ou a cota; a próxima execução continua de onde parou.
        O limite não garante uma quantidade de resultados.
        {value !== null && <> Valor atual: <strong>{value}</strong> requisições por execução.</>}
      </p>
      <div className="setting-form">
        <input
          className="text-input setting-input"
          type="number" min={1} max={MAX_COLLECTION_REQUESTS} step={1}
          value={input}
          aria-label="Requisições por execução"
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
