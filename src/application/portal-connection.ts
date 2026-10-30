import type { PortalCommand } from "../domain/portal-command";
import type { PortalState } from "../domain/types";

export interface PortalSnapshot {
  state: PortalState;
  version: number;
}

export interface PortalConnection {
  initialState: PortalState;
  execute(command: PortalCommand): Promise<PortalState>;
  reload(): Promise<PortalState>;
}
