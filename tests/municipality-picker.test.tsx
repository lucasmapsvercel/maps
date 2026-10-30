import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SearchDialog } from "../src/presentation/components/search-dialog";
import type { Portal } from "../src/presentation/use-portal";

afterEach(() => vi.unstubAllGlobals());

const belem = { ibgeCode: "1501402", name: "Belém", stateCode: "PA", stateName: "Pará", country: "Brasil" };
const municipalities = [belem, { ...belem, ibgeCode: "2700805", stateCode: "AL", stateName: "Alagoas" }];

function portal(): Portal {
  return {
    service: null as never, state: null as never, notice: null, mutate: vi.fn().mockResolvedValue(true),
    pending: 0, remote: true, forceRefresh: vi.fn()
  };
}

test("typing a municipality is not confirmation; selecting a homonym persists its exact identity", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValue(Response.json({ municipalities }));
  vi.stubGlobal("fetch", fetch);
  const state = portal();
  const close = vi.fn();
  render(<SearchDialog portal={state} onClose={close} />);
  const input = screen.getByRole("combobox", { name: "Município" });
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(screen.getByLabelText("Termo de pesquisa"), "Farmácia");
  await user.type(input, "belem");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  const save = screen.getByRole("button", { name: /Salvar busca/ });
  expect(save).toBeDisabled();
  fireEvent.submit(save.closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Selecione um município válido");
  expect(state.mutate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("option", { name: /Belém — PA/ }));
  expect(input).toHaveValue("Belém — PA");
  expect(screen.getByText(/Código IBGE 1501402/)).toBeInTheDocument();
  expect(save).toBeEnabled();
  await user.click(save);
  expect(state.mutate).toHaveBeenCalledWith({
    type: "addSearch", term: "Farmácia", city: "Belém, Pará, Brasil", municipality: belem
  }, expect.any(String));
  expect(close).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/municipalities");
});

test("keyboard selection works and editing invalidates the previously selected municipality", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ municipalities })));
  render(<SearchDialog portal={portal()} onClose={vi.fn()} />);
  const input = screen.getByRole("combobox");
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "BELEM al");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(input).toHaveValue("Belém — AL");
  expect(screen.getByText(/Código IBGE 2700805/)).toBeInTheDocument();
  await user.clear(input);
  expect(screen.getByRole("button", { name: /Salvar busca/ })).toBeDisabled();
  await user.type(input, "inexistente");
  expect(screen.getByText("Nenhum município encontrado.")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(input).toHaveAttribute("aria-expanded", "false");
});

test("catalog errors are shown, retry loads suggestions and no default city is silently chosen", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ error: "IBGE indisponível" }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ municipalities })));
  render(<SearchDialog portal={portal()} onClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("IBGE indisponível");
  expect(screen.getByRole("combobox")).toHaveValue("");
  expect(screen.getByRole("combobox")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Tentar carregar municípios novamente" }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  await user.type(screen.getByRole("combobox"), "belem pa");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /Salvar busca/ })).toBeDisabled();
});
