import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { App } from "../src/presentation/app";
import { createDemoState } from "../src/infrastructure/demo-state";
import { LocalStorageRepository, STORAGE_KEY } from "../src/infrastructure/local-storage-repository";
import type { PortalState } from "../src/domain/types";

function fixture() {
  const data = new Map<string, string>();
  const repository = new LocalStorageRepository({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  });
  return { repository, data };
}

test("React filters map and list together and restores all markers when clearing", async () => {
  const { repository } = fixture();
  const user = userEvent.setup();
  render(<App repository={repository} />);
  const map = screen.getByRole("region", { name: "Mapa de estabelecimentos" });
  const list = screen.getByRole("region", { name: "Lista de resultados" });
  expect(within(map).getByText(/5 pontos/)).toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "Norte");
  expect(within(map).getByText(/1 ponto/)).toBeInTheDocument();
  expect(within(list).getByText("Loja Modelo Norte")).toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));
  expect(within(map).getByText(/5 pontos/)).toBeInTheDocument();
});

test("favorite, comment, override, hide and restore remain functional across remounts", async () => {
  const { repository } = fixture();
  const user = userEvent.setup();
  const view = render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  let dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Adicionar aos favoritos" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Novo comentário" }), "<b>Comentário sintético</b>");
  await user.click(within(dialog).getByRole("button", { name: "Adicionar" }));
  expect(within(dialog).getByText("<b>Comentário sintético</b>")).toBeInTheDocument();
  expect(dialog.querySelector("b")).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: /Editar dados locais/ }));
  await user.type(within(dialog).getByLabelText("Telefone"), "0000");
  await user.click(within(dialog).getByRole("button", { name: "Salvar dados locais" }));
  await user.click(within(dialog).getByRole("button", { name: "Fechar detalhes" }));
  view.unmount();
  render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("0000")).toBeInTheDocument();
  expect(within(dialog).getByText("<b>Comentário sintético</b>")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Remover dos favoritos" })).toHaveAttribute("aria-pressed", "true");
  await user.click(within(dialog).getByRole("button", { name: "Ocultar nesta busca" }));
  await user.click(within(dialog).getByRole("button", { name: "Fechar detalhes" }));
  expect(screen.queryByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Visibilidade" }), "hidden");
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restaurar nesta busca" }));
  expect(repository.load()?.searches[0].hiddenIds).toEqual([]);
});

test("React saves independent search tabs, closes without deleting and reopens saved search", async () => {
  const { repository } = fixture();
  const user = userEvent.setup();
  render(<App repository={repository} />);
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ municipalities: [{
    ibgeCode: "1501402", name: "Belém", stateCode: "PA", stateName: "Pará", country: "Brasil"
  }] }));
  await user.click(screen.getByRole("button", { name: "＋ Nova busca" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Termo de pesquisa"), "Farmácia");
  await user.type(within(dialog).getByRole("combobox", { name: "Município" }), "belem");
  await user.click(await within(dialog).findByRole("option", { name: /Belém — PA/ }));
  await user.click(within(dialog).getByRole("button", { name: /Salvar busca/ }));
  transport.mockRestore();
  expect(repository.load()?.searches).toHaveLength(2);
  expect(repository.load()?.searches[0].municipality?.ibgeCode).toBe("1501402");
  await user.click(screen.getByRole("button", { name: "Fechar aba Farmácia" }));
  expect(repository.load()?.searches).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Buscas salvas" }));
  const items = screen.getAllByRole("article");
  const saved = items.find((item) => item.textContent?.includes("Farmácia"));
  expect(saved).toBeDefined();
  if (!saved) throw new Error("Missing saved search");
  await user.click(within(saved).getByRole("button", { name: /Abrir busca/ }));
  expect(screen.getByRole("heading", { name: "Farmácia" })).toBeInTheDocument();
});

test("saved search deletion requires confirmation, supports cancel and preserves collected data across remounts", async () => {
  const { repository } = fixture();
  const initial = createDemoState();
  initial.page = "saved";
  initial.favorites = ["demo-01"];
  initial.comments["demo-01"] = [{ text: "Manter", createdAt: "2026-10-30" }];
  repository.save(initial);
  const user = userEvent.setup();
  const view = render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Excluir busca Aparelho auditivo" }));
  let dialog = screen.getByRole("dialog", { name: "Excluir busca salva" });
  expect(dialog).toHaveTextContent("Estabelecimentos, favoritos");
  await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(repository.load()?.searches).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Excluir busca Aparelho auditivo" }));
  dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Confirmar exclusão" }));
  expect(await screen.findByText("Ainda não há buscas salvas")).toBeInTheDocument();
  expect(repository.load()).toMatchObject({
    searches: [], openTabs: [], activeSearchId: null, places: initial.places,
    favorites: initial.favorites, comments: initial.comments
  });
  view.unmount();
  render(<App repository={repository} />);
  expect(screen.getByText("Ainda não há buscas salvas")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Favoritos" }));
  expect(screen.getByText("Clínica Exemplo Centro")).toBeInTheDocument();
});

test("a failed deletion retains the confirmation and the saved search for retry", async () => {
  const { repository } = fixture();
  const initial = createDemoState();
  initial.page = "saved";
  repository.save(initial);
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Excluir busca Aparelho auditivo" }));
  const save = vi.spyOn(repository, "save").mockImplementation(() => { throw new Error("Falha de armazenamento"); });
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Confirmar exclusão" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Falha de armazenamento");
  expect(repository.load()?.searches).toHaveLength(1);
  save.mockRestore();
  await user.click(within(dialog).getByRole("button", { name: "Confirmar exclusão" }));
  expect(await screen.findByText("Ainda não há buscas salvas")).toBeInTheDocument();
});

test("storage failure retains drafts, rolls back changes and retries without duplicate comments", async () => {
  const { repository } = fixture();
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  const dialog = screen.getByRole("dialog");
  const save = vi.spyOn(repository, "save").mockImplementation(() => { throw new Error("quota exceeded"); });
  const input = within(dialog).getByRole("textbox", { name: "Novo comentário" });
  await user.type(input, "Preservar rascunho");
  await user.click(within(dialog).getByRole("button", { name: "Adicionar" }));
  expect(input).toHaveValue("Preservar rascunho");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("quota exceeded");
  expect(within(dialog).queryByText("Comentário salvo neste navegador.")).not.toBeInTheDocument();
  save.mockRestore();
  await user.click(within(dialog).getByRole("button", { name: "Adicionar" }));
  expect(repository.load()?.comments["demo-01"]).toHaveLength(1);
  expect(input).toHaveValue("");
});

test("existing JavaScript portal data loads in React; corrupt data reports an error", () => {
  const { repository, data } = fixture();
  const legacy: PortalState = createDemoState();
  legacy.favorites = ["demo-02"];
  data.set(STORAGE_KEY, JSON.stringify(legacy));
  const view = render(<App repository={repository} />);
  expect(screen.getByRole("button", { name: "Remover dos favoritos" })).toBeInTheDocument();
  view.unmount();
  data.set(STORAGE_KEY, "{}");
  render(<App repository={repository} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
});

test("dialog Escape closes through React state and mobile view selection persists", async () => {
  const { repository } = fixture();
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Lista" }));
  expect(repository.load()?.mobileView).toBe("list");
  await user.click(screen.getByRole("button", { name: "＋ Nova busca" }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
