import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { CollectionPanel } from "../src/presentation/components/collection-panel";
import type { Portal } from "../src/presentation/use-portal";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const search = {
  id: "batch-search", term: "Teste", city: "Belém", demo: false, createdAt: "2026-10-30",
  placeIds: Array.from({ length: 25 }, (_, index) => `place-${index}`), hiddenIds: []
};
const quota = { used: 2, limit: 5000, remaining: 4998, month: "10/2026", maxRequestsPerRun: 100, resultsPerRequest: 20 };
const municipalCoverage = { mode: "municipality", total: 0, completed: 0, reason: "catalog_unavailable" };
function portal(): Portal {
  return {
    service: null as never, state: null as never, notice: null, mutate: vi.fn(),
    pending: 0, remote: true, forceRefresh: vi.fn().mockResolvedValue(undefined)
  };
}

test("a completed batch can continue after reopening even when 25 places are already saved", async () => {
  const user = userEvent.setup();
  const refresh = portal();
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/plan?")) return Response.json(municipalCoverage);
    if (url.endsWith("/quota")) return Response.json(quota);
    if (url.includes("?searchId=")) return Response.json([{ id: "previous", status: "done", importedCount: 25, hasMore: true }]);
    if (options?.method === "POST") return Response.json({ jobId: "next" }, { status: 202 });
    return Response.json({ id: "next", status: "done", importedCount: 25, hasMore: false, requestsMade: 2, maxRequestsPerRun: 100 });
  });
  vi.stubGlobal("fetch", fetch);
  render(<CollectionPanel search={search} portal={refresh} />);
  const button = await screen.findByRole("button", { name: "Continuar coleta" });
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getByText(/Cada execução realiza até 100 requisições/)).toBeInTheDocument();
  expect(screen.getByText(/Cada requisição solicita até 20 resultados/)).toBeInTheDocument();
  await user.click(button);
  expect(fetch).toHaveBeenCalledWith("/api/v1/collection/run", expect.objectContaining({
    method: "POST", body: JSON.stringify({ searchId: search.id, confirmed: true })
  }));
  expect(await screen.findByText(/O Google não disponibilizou mais resultados/, {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continuar coleta" })).not.toBeInTheDocument();
  await waitFor(() => expect(refresh.forceRefresh).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/2 requisição\(ões\) realizada\(s\)/)).toBeInTheDocument();
});

test("an exhausted search remains blocked after reopening without a paid request", async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url.includes("/plan?") ? municipalCoverage : url.endsWith("/quota") ? quota
    : [{ id: "finished", status: "done", hasMore: false }]));
  vi.stubGlobal("fetch", fetch);
  render(<CollectionPanel search={search} portal={portal()} />);
  expect(await screen.findByText(/O Google não disponibilizou mais resultados/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continuar coleta" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("slow progress requests never overlap and unmount aborts polling without refreshing the portal", async () => {
  vi.useFakeTimers();
  const state = portal();
  let release!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/plan?")) return Response.json(municipalCoverage);
    if (url.endsWith("/quota")) return Response.json(quota);
    if (url.includes("?searchId=")) return Response.json([{ id: "running", status: "running" }]);
    signal = options?.signal ?? undefined;
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<CollectionPanel search={search} portal={state} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(fetch).toHaveBeenCalledTimes(4);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { release(Response.json({ id: "running", status: "done", hasMore: false })); });
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(state.forceRefresh).not.toHaveBeenCalled();
});

test("polling recovers from a progress error and stops when the job finishes", async () => {
  vi.useFakeTimers();
  const state = portal();
  let polls = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("/plan?")) return Response.json(municipalCoverage);
    if (url.endsWith("/quota")) return Response.json(quota);
    if (url.includes("?searchId=")) return Response.json([{ id: "running", status: "running" }]);
    return ++polls === 1 ? new Response("", { status: 503 })
      : Response.json({ id: "running", status: "done", hasMore: false });
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<CollectionPanel search={search} portal={state} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(screen.getByRole("alert")).toHaveTextContent("Tentaremos novamente");
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText(/O Google não disponibilizou mais resultados/)).toBeInTheDocument();
  expect(state.forceRefresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(polls).toBe(2);
  view.unmount();
});

test("running jobs refresh imported results progressively without refreshing unchanged progress", async () => {
  vi.useFakeTimers();
  const state = portal();
  let count = 20;
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("/plan?")) return Response.json(municipalCoverage);
    if (url.endsWith("/quota")) return Response.json(quota);
    if (url.includes("?searchId=")) return Response.json([{ id: "running", status: "running" }]);
    return Response.json({ id: "running", status: "running", collectedSoFar: count, requestsMade: 2 });
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<CollectionPanel search={search} portal={state} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(state.forceRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/20 estabelecimento\(s\) importado\(s\) nesta execução/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(state.forceRefresh).toHaveBeenCalledTimes(1);
  count = 40;
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(state.forceRefresh).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/40 estabelecimento\(s\) importado\(s\) nesta execução/)).toBeInTheDocument();
  view.unmount();
});

test("all neighborhoods are automatic and progress shares the execution request limit", async () => {
  vi.useFakeTimers();
  const state = portal();
  const coverage = { mode: "neighborhoods", total: 71, completed: 24, current: "Cremação", catalogDate: "2022" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/quota")) return Response.json(quota);
    if (url.includes("?searchId=")) return Response.json([{ id: "running", status: "running", coverage }]);
    return Response.json({ id: "running", status: "running", coverage: { ...coverage, completed: 25, current: "Cruzeiro" } });
  }));
  const view = render(<CollectionPanel search={search} portal={state} />);
  await act(async () => {});
  expect(screen.getByText(/todos os 71 bairros disponíveis/)).toBeInTheDocument();
  expect(screen.getByText(/Consultando: Cremação — bairro 25 de 71/)).toBeInTheDocument();
  expect(screen.getByText(/100 requisições é compartilhado entre todos os bairros/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(screen.getByText(/Consultando: Cruzeiro — bairro 26 de 71/)).toBeInTheDocument();
  view.unmount();
});

test("a missing catalog explicitly shows the municipal fallback before starting", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(
    url.endsWith("/quota") ? quota : url.includes("/plan?") ? municipalCoverage : []
  )));
  render(<CollectionPanel search={{ ...search, placeIds: [] }} portal={portal()} />);
  expect(await screen.findByText(/Divisão por bairros indisponível/)).toHaveTextContent("município inteiro");
  expect(screen.getByRole("button", { name: "Coletar estabelecimentos" })).toBeEnabled();
});

test("a plan failure blocks collection instead of silently falling back to the municipality", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/quota") ? Response.json(quota)
    : url.includes("/plan?") ? new Response("", { status: 503 }) : Response.json([])));
  render(<CollectionPanel search={{ ...search, placeIds: [] }} portal={portal()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar");
  expect(screen.getByRole("button", { name: "Coletar estabelecimentos" })).toBeDisabled();
  expect(screen.queryByText(/Divisão por bairros indisponível/)).not.toBeInTheDocument();
});
