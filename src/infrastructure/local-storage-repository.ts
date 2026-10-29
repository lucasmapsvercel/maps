import { validateState } from "../domain/portal-state";
import type { PortalRepository, PortalState } from "../domain/types";

export const STORAGE_KEY = "maps.portal.demo.v1";

export class LocalStorageRepository implements PortalRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  load() {
    const saved = this.storage.getItem(STORAGE_KEY);
    return saved === null ? null : validateState(JSON.parse(saved));
  }

  save(state: PortalState) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
