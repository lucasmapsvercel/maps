import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { CollectionPanel } from "../src/presentation/components/collection-panel";
import type { Portal } from "../src/presentation/use-portal";

afterEach(() => vi.unstubAllGlobals());

const search = {
  id: "batch-search", term: "Teste", city: "Belém", demo: false, createdAt: "2026-10-30",
  placeIds: Array.from({ length: 25 }, (_, index) => `place-${index}`), hiddenIds: []
};
const quota = { used: 2, limit: 5000, remaining: 4998, month: "10/2026", maxRequestsPerRun: 100, resultsPerRequest: 20 };
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
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith("/quota") ? quota
    : [{ id: "finished", status: "done", hasMore: false }]));
  vi.stubGlobal("fetch", fetch);
  render(<CollectionPanel search={search} portal={portal()} />);
  expect(await screen.findByText(/O Google não disponibilizou mais resultados/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continuar coleta" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});
