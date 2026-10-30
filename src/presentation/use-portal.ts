import { useCallback, useRef, useState } from "react";
import { PortalService } from "../application/portal-service";
import type { PortalConnection } from "../application/portal-connection";
import { isViewCommand, type PortalCommand } from "../domain/portal-command";
import type { PortalRepository } from "../domain/types";
import { createDemoState } from "../infrastructure/demo-state";

export interface Notice {
  message: string;
  error: boolean;
}

function initialize(repository: PortalRepository) {
  try {
    return { state: repository.load() || createDemoState(), notice: null };
  } catch (error) {
    return {
      state: createDemoState(),
      notice: { message: `Não foi possível carregar os dados locais: ${errorMessage(error)}`, error: true }
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro desconhecido.";
}

export function usePortal(source: PortalRepository | PortalConnection) {
  const remote = "execute" in source;
  const [initial] = useState(() => remote ? { state: source.initialState, notice: null } : initialize(source));
  const [service] = useState(() => new PortalService({ state: initial.state, repository: remote ? undefined : source }));
  const [, setRevision] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(initial.notice);
  const queue = useRef(Promise.resolve());
  const pendingViews = useRef<PortalCommand[]>([]);
  const confirmedState = useRef(structuredClone(initial.state));
  const [pending, setPending] = useState(0);

  function localMutation(command: PortalCommand, message: string): boolean {
    const previous = structuredClone(service.state);
    try {
      service.execute(command);
    } catch (error) {
      service.state = previous;
      setNotice({ message: errorMessage(error), error: true });
      return false;
    }
    try {
      service.save();
    } catch (error) {
      service.state = previous;
      setNotice({ message: `Não foi possível salvar no navegador: ${errorMessage(error)}. Sua alteração não foi salva; tente novamente.`, error: true });
      return false;
    }
    setNotice(message ? { message, error: false } : null);
    setRevision((value) => value + 1);
    return true;
  }

  function mutate(command: PortalCommand, message = ""): Promise<boolean> {
    if (!remote) return Promise.resolve(localMutation(command, message));
    if (isViewCommand(command)) {
      try {
        service.execute(command);
        pendingViews.current.push(command);
        setRevision((value) => value + 1);
      } catch (error) {
        setNotice({ message: errorMessage(error), error: true });
        return Promise.resolve(false);
      }
    }
    setPending((value) => value + 1);
    const result = queue.current.then(async () => {
      try {
        const state = await source.execute(command);
        confirmedState.current = structuredClone(state);
        pendingViews.current = pendingViews.current.filter((item) => item !== command);
        service.state = state;
        for (const view of pendingViews.current) service.execute(view);
        setNotice(message ? { message, error: false } : null);
        return true;
      } catch (error) {
        pendingViews.current = pendingViews.current.filter((item) => item !== command);
        setNotice({ message: errorMessage(error), error: true });
        return false;
      } finally {
        service.state = structuredClone(confirmedState.current);
        for (const view of pendingViews.current) service.execute(view);
        setPending((value) => value - 1);
        setRevision((value) => value + 1);
      }
    });
    queue.current = result.then(() => undefined);
    return result;
  }

  const forceRefresh = useCallback(async () => {
    if (!remote) return;
    const result = queue.current.then(async () => {
      try {
        const state = await source.reload();
        const current = confirmedState.current;
        const searchIds = new Set(state.searches.map((search) => search.id));
        const openTabs = current.openTabs.filter((id) => searchIds.has(id));
        confirmedState.current = {
          ...state,
          page: current.page, mobileView: current.mobileView,
          searchFilter: current.searchFilter, visibility: current.visibility, favoriteOnly: current.favoriteOnly,
          openTabs,
          activeSearchId: current.activeSearchId && searchIds.has(current.activeSearchId)
            ? current.activeSearchId : openTabs.at(-1) ?? null
        };
        service.state = structuredClone(confirmedState.current);
        for (const view of pendingViews.current) service.execute(view);
        setRevision((v) => v + 1);
      } catch (error) {
        setNotice({ message: errorMessage(error), error: true });
      }
    });
    queue.current = result;
    await result;
  }, [remote, source, service]);

  return { service, state: service.state, notice, mutate, pending, remote, forceRefresh };
}

export type Portal = ReturnType<typeof usePortal>;
