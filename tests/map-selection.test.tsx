import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { Map as LeafletMap } from "leaflet";
import { App } from "../src/presentation/app";
import { createDemoState } from "../src/infrastructure/demo-state";
import { LocalStorageRepository } from "../src/infrastructure/local-storage-repository";

vi.mock("next/dynamic", async () => {
  const { MapView } = await import("../src/presentation/components/map-view");
  return { default: () => MapView };
});

beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });

function fixture() {
  const data = new Map<string, string>();
  const repository = new LocalStorageRepository({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  });
  repository.save(createDemoState());
  return repository;
}

test("map and list share selection and show one inline details panel without popups", async () => {
  const user = userEvent.setup();
  const view = render(<App repository={fixture()} />);
  const map = screen.getByRole("region", { name: "Mapa de estabelecimentos" });
  const marker = await within(map).findByRole("button", { name: "Loja Modelo Norte" });
  const fitBounds = vi.spyOn(LeafletMap.prototype, "fitBounds");
  await user.click(marker);
  const row = screen.getByRole("button", { name: "Ver detalhes de Loja Modelo Norte" });
  expect(row).toHaveAttribute("aria-pressed", "true");
  expect(row.closest("article")).toHaveClass("is-selected");
  expect(marker).toHaveAttribute("aria-pressed", "true");
  const details = screen.getByRole("region", { name: "Detalhes de Loja Modelo Norte" });
  const list = screen.getByRole("region", { name: "Lista de resultados" });
  expect(list.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(view.container.querySelector(".leaflet-popup")).toBeNull();
  expect(fitBounds).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  expect(row).toHaveAttribute("aria-pressed", "false");
  expect(marker).toHaveAttribute("aria-pressed", "false");
  expect(within(map).getByRole("button", { name: "Clínica Exemplo Centro" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("region", { name: "Detalhes de Loja Modelo Norte" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Fechar detalhes" }));
  expect(screen.queryByRole("region", { name: /Detalhes de/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" })).toHaveAttribute("aria-pressed", "false");
});

test("selecting a marker reveals its row by scrolling only the results list", async () => {
  const view = render(<App repository={fixture()} />);
  const map = screen.getByRole("region", { name: "Mapa de estabelecimentos" });
  const marker = await within(map).findByRole("button", { name: "Unidade Ilustrativa Leste" });
  const row = screen.getByRole("button", { name: "Ver detalhes de Unidade Ilustrativa Leste" }).closest("article")!;
  const list = row.closest(".list-scroll")!;
  const scroll = vi.fn();
  Object.defineProperty(list, "scrollTo", { configurable: true, value: scroll });
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 400, 200));
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 450, 400, 65));
  fireEvent.click(marker);
  expect(scroll).toHaveBeenCalledWith({ top: 350, behavior: "smooth" });
  expect(view.container.querySelectorAll(".place-details")).toHaveLength(1);
});

test("navigation hides details, favorites use inline details and switching search cannot show stale details", async () => {
  const user = userEvent.setup();
  const repository = fixture();
  const state = repository.load()!;
  state.favorites = ["demo-01"];
  state.searches.push({ ...state.searches[0], id: "another-search", term: "Outra busca", placeIds: [] });
  state.openTabs.push("another-search");
  repository.save(state);
  render(<App repository={repository} />);
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  await user.click(screen.getByRole("button", { name: "Outra busca · Belém" }));
  expect(screen.queryByRole("region", { name: /Detalhes de/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Buscas salvas" }));
  expect(screen.queryByRole("region", { name: /Detalhes de/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Favoritos" }));
  await user.click(screen.getByRole("button", { name: "Ver detalhes de Clínica Exemplo Centro" }));
  expect(screen.getByRole("region", { name: "Detalhes de Clínica Exemplo Centro" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(within(screen.getByRole("region", { name: /Detalhes de/ })).getByRole("button", { name: "Remover dos favoritos" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: /Detalhes de/ })).not.toBeInTheDocument());
});
