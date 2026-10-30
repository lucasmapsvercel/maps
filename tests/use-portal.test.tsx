import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { PortalConnection } from "../src/application/portal-connection";
import type { PortalState } from "../src/domain/types";
import { createDemoState } from "../src/infrastructure/demo-state";
import { PortalService } from "../src/application/portal-service";
import { usePortal } from "../src/presentation/use-portal";

test("background refresh preserves current navigation and updates confirmed data used by later commands", async () => {
  const initial = createDemoState();
  initial.page = "settings";
  initial.searchFilter = "Clínica";
  const updated = structuredClone(initial);
  updated.page = "dashboard";
  updated.searchFilter = "";
  updated.places["new-place"] = { id: "new-place", name: "Novo resultado", address: "Rua", category: "" };
  const connection: PortalConnection = {
    initialState: initial, reload: vi.fn().mockResolvedValue(updated),
    execute: vi.fn().mockRejectedValue(new Error("Falha ao salvar"))
  };
  const { result } = renderHook(() => usePortal(connection));
  await act(async () => { await result.current.forceRefresh(); });
  expect(result.current.state.page).toBe("settings");
  expect(result.current.state.searchFilter).toBe("Clínica");
  expect(result.current.state.places["new-place"]).toBeDefined();
  await act(async () => { await result.current.mutate({ type: "toggleFavorite", id: "new-place" }); });
  expect(result.current.state.page).toBe("settings");
  expect(result.current.state.places["new-place"]).toBeDefined();
  expect(result.current.notice?.error).toBe(true);
});

test("navigation during an in-flight refresh stays visible and is reapplied to the refreshed data", async () => {
  const initial = createDemoState();
  let release!: (state: PortalState) => void;
  const reload = vi.fn(() => new Promise<PortalState>((resolve) => { release = resolve; }));
  const connection: PortalConnection = {
    initialState: initial, reload,
    execute: vi.fn(async (command) => {
      const service = new PortalService({ state: structuredClone(initial) });
      service.execute(command);
      return service.state;
    })
  };
  const { result } = renderHook(() => usePortal(connection));
  let refreshing!: Promise<void>;
  await act(async () => {
    refreshing = result.current.forceRefresh();
    await Promise.resolve();
  });
  let navigating!: Promise<boolean>;
  act(() => { navigating = result.current.mutate({ type: "navigate", page: "settings" }); });
  expect(result.current.state.page).toBe("settings");
  expect(connection.execute).not.toHaveBeenCalled();
  await act(async () => {
    release(structuredClone(initial));
    await refreshing;
    await navigating;
  });
  expect(result.current.state.page).toBe("settings");
  expect(result.current.pending).toBe(0);
});

test("refresh reconciles deleted search tabs without changing the current page", async () => {
  const initial = createDemoState();
  initial.page = "saved";
  const updated = structuredClone(initial);
  updated.searches = [];
  const connection: PortalConnection = {
    initialState: initial, reload: vi.fn().mockResolvedValue(updated), execute: vi.fn()
  };
  const { result } = renderHook(() => usePortal(connection));
  await act(async () => { await result.current.forceRefresh(); });
  expect(result.current.state).toMatchObject({ page: "saved", activeSearchId: null, openTabs: [], searches: [] });
});
