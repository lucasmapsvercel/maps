import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { CollectionSettings } from "../src/presentation/components/collection-settings";

afterEach(() => vi.unstubAllGlobals());

test("configuration saves requests per execution rather than results, up to 5000", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ maxRequestsPerRun: 100 }))
    .mockResolvedValueOnce(Response.json({ maxRequestsPerRun: 5000 }));
  vi.stubGlobal("fetch", fetch);
  render(<CollectionSettings />);
  const input = screen.getByRole("spinbutton", { name: "Requisições por execução" });
  await waitFor(() => expect(input).toHaveValue(100));
  expect(input).toHaveAttribute("max", "5000");
  expect(input).toHaveAttribute("step", "1");
  expect(screen.getByText(/máximo permitido: 20 resultados/)).toBeInTheDocument();
  await user.clear(input);
  await user.type(input, "5001");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("entre 1 e 5000");
  expect(fetch).toHaveBeenCalledTimes(1);
  await user.clear(input);
  await user.type(input, "5000");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByRole("status")).toHaveTextContent("5000 requisições por execução");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ maxRequestsPerRun: 5000 });
});

test.each(["http", "schema"])("configuration reports %s loading errors", async (failure) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure === "http"
    ? Response.json({ error: "Indisponível" }, { status: 503 })
    : Response.json({ maxResultsPerSearch: 100 })));
  render(<CollectionSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar");
  expect(screen.getByRole("spinbutton")).toBeDisabled();
});
