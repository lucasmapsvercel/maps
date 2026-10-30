import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { GoogleSearchLogs } from "../src/presentation/components/google-search-logs";
import { Settings } from "../src/presentation/components/pages";

afterEach(() => vi.unstubAllGlobals());

const log = {
  id: "fixture-log", createdAt: "2026-10-30T05:00:00.000Z",
  actorName: "Ana", searchId: "search-1", term: "Farmácia", city: "Belém",
  source: "collection", continuation: true, status: "success", durationMs: 120, resultCount: 0
};

test("settings history displays metadata and refreshes without Google calls", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ logs: [log] }))
    .mockResolvedValueOnce(Response.json({ logs: [{ ...log, status: "failed", errorCode: "GOOGLE_CONNECTION_FAILED", resultCount: undefined }] }));
  vi.stubGlobal("fetch", fetch);
  render(<GoogleSearchLogs />);
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Farmácia")).toBeInTheDocument();
  expect(within(table).getByText("Belém")).toBeInTheDocument();
  expect(within(table).getByText("Ana")).toBeInTheDocument();
  expect(within(table).getByText("Coleta (continuação)")).toBeInTheDocument();
  expect(within(table).getByText("Sucesso")).toBeInTheDocument();
  expect(within(table).getByText("0")).toBeInTheDocument();
  expect(within(table).getByText("120 ms")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Atualizar logs" }));
  expect(await screen.findByText("GOOGLE_CONNECTION_FAILED")).toBeInTheDocument();
  expect(screen.getByText("Falha")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetch.mock.calls) {
    expect(url).toBe("/api/v1/collection/logs");
    expect(options.cache).toBe("no-store");
  }
});

test("empty and incomplete history do not report false success", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ logs: [] }))
    .mockResolvedValueOnce(Response.json({ logs: [{ ...log, status: "pending", durationMs: undefined, resultCount: undefined }] })));
  render(<GoogleSearchLogs />);
  expect(await screen.findByText("Nenhuma consulta registrada.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Atualizar logs" }));
  expect(await screen.findByText("Sem conclusão registrada")).toBeInTheDocument();
  expect(screen.queryByText("Sucesso")).not.toBeInTheDocument();
});

test.each(["http", "invalid", "network"])("history reports %s failures and permits retry", async (failure) => {
  const user = userEvent.setup();
  const fetch = vi.fn();
  if (failure === "network") fetch.mockRejectedValueOnce(new Error("Conexão indisponível"));
  else fetch.mockResolvedValueOnce(failure === "http"
    ? Response.json({ error: "Indisponível" }, { status: 503 }) : Response.json({ logs: [{}] }));
  fetch.mockResolvedValueOnce(Response.json({ logs: [] }));
  vi.stubGlobal("fetch", fetch);
  render(<GoogleSearchLogs />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("Nenhuma consulta registrada.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Atualizar logs" }));
  expect(await screen.findByText("Nenhuma consulta registrada.")).toBeInTheDocument();
});

test("demo settings do not request remote logs", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<Settings />);
  expect(screen.queryByRole("region", { name: "Logs de consultas ao Google" })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
