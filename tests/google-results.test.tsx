import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { GoogleSearchResults } from "../src/presentation/components/google-search-results";
import type { Portal } from "../src/presentation/use-portal";

afterEach(() => vi.unstubAllGlobals());
const search = { id: "fixture-search", term: "Teste", city: "Belém", placeIds: [], hiddenIds: [], createdAt: "2026-01-01", demo: false };

function makePortal(mutate = vi.fn().mockResolvedValue(true)): Portal {
  return { service: null as never, state: null as never, notice: null, mutate, pending: 0, remote: true, forceRefresh: vi.fn().mockResolvedValue(undefined) };
}

test("Google list requires explicit confirmation, displays attribution and filters without new calls", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValue(Response.json({
    searchId: search.id,
    places: [{ id: "fixture-id", name: "Empresa sintética", address: "Rua teste", attributions: [{ provider: "Fornecedor teste" }] }],
    expiresAt: new Date(Date.now() + 600000).toISOString(), limited: true
  }));
  vi.stubGlobal("fetch", fetch);
  render(<GoogleSearchResults search={search} portal={makePortal()} />);
  expect(fetch).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "Consultar Google Places" });
  expect(button).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(button);
  expect(await screen.findByText("Empresa sintética")).toBeInTheDocument();
  expect(screen.getByText("Google Maps")).toBeInTheDocument();
  expect(screen.getByText(/Fornecedor teste/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await user.type(screen.getByRole("searchbox"), "inexistente");
  expect(screen.queryByText("Empresa sintética")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ searchId: search.id, confirmed: true });
});

test("expired results are removed and failed calls do not show success", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({
    searchId: search.id, places: [], expiresAt: new Date(Date.now() - 1).toISOString(), limited: false
  })).mockResolvedValueOnce(Response.json({ error: "Limite mensal atingido" }, { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  render(<GoogleSearchResults search={search} portal={makePortal()} />);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Consultar Google Places" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("expirou"));
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Consultar Google Places" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Limite mensal");
  expect(screen.queryByText("Resultados do Google Maps")).not.toBeInTheDocument();
});
