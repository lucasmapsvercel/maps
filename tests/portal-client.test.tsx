import { renderToString } from "react-dom/server";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PortalClient } from "../src/presentation/portal-client";
import { createDemoState } from "../src/infrastructure/demo-state";
import { PortalService } from "../src/application/portal-service";
import { portalCommandSchema } from "../src/domain/portal-command";

afterEach(() => vi.unstubAllGlobals());

test("Next.js client boundary does not fetch or read browser storage during SSR", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const load = vi.spyOn(Storage.prototype, "getItem");
  expect(renderToString(<PortalClient />)).toContain("Carregando o portal MAPS");
  expect(load).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("client restores server data without reading browser storage", async () => {
  const state = createDemoState();
  state.favorites = ["demo-02"];
  const load = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("local storage forbidden"); });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ state, version: 3 })));
  render(<PortalClient />);
  expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remover dos favoritos" })).toHaveAttribute("aria-pressed", "true");
  expect(load).not.toHaveBeenCalled();
});

test("server outage is explicit and never falls back to demo data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "MongoDB indisponível" }, { status: 503 })));
  render(<PortalClient />);
  expect(await screen.findByRole("alert")).toHaveTextContent("MongoDB indisponível");
  expect(screen.queryByRole("heading", { name: "Visão geral" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
});

test("remote save failure preserves drafts and confirmed state", async () => {
  const user = userEvent.setup();
  const state = createDemoState();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ state, version: 1 }))
    .mockResolvedValueOnce(Response.json({ error: "Alteração concorrente. Recarregue o portal." }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  render(<PortalClient />);
  await user.click(await screen.findByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: "Novo comentário" }), "Rascunho mantido");
  await user.click(within(dialog).getByRole("button", { name: "Adicionar" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Alteração concorrente");
  expect(within(dialog).getByRole("textbox", { name: "Novo comentário" })).toHaveValue("Rascunho mantido");
  expect(within(dialog).queryByText("Comentário salvo no MongoDB.")).not.toBeInTheDocument();
  const body: unknown = JSON.parse(fetch.mock.calls[1][1].body);
  expect(body).toMatchObject({ version: 1, command: { type: "addComment", id: "demo-01", text: "Rascunho mantido" } });
  expect(body).not.toHaveProperty("workspaceId");
});

test("rapid remote filters are serialized with consecutive versions and preserve the latest input", async () => {
  const user = userEvent.setup();
  const service = new PortalService({ state: createDemoState() });
  let version = 0;
  const versions: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.body) {
      const body: { command: unknown; version: number } = JSON.parse(String(options.body));
      versions.push(body.version);
      expect(body.version).toBe(version);
      await new Promise((resolve) => setTimeout(resolve, 10));
      service.execute(portalCommandSchema.parse(body.command));
      version++;
    }
    return Response.json({ state: service.state, version });
  }));
  render(<PortalClient />);
  const input = await screen.findByRole("searchbox", { name: "Filtrar resultados" });
  await user.type(input, "Norte");
  expect(input).toHaveValue("Norte");
  await waitFor(() => expect(version).toBe(5));
  expect(versions).toEqual([0, 1, 2, 3, 4]);
  expect(input).toHaveValue("Norte");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Lista de resultados" })).getByText("Loja Modelo Norte")).toBeInTheDocument();
});
