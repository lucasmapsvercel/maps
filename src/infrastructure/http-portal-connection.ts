import { z } from "zod";
import type { PortalConnection, PortalSnapshot } from "../application/portal-connection";
import type { PortalCommand } from "../domain/portal-command";
import { validateState } from "../domain/portal-state";

const responseSchema = z.object({ version: z.number().int().nonnegative(), state: z.unknown() });

async function decode(response: Response): Promise<PortalSnapshot> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string(), requestId: z.string().optional() }).safeParse(body);
    throw new Error(error.success
      ? `${error.data.error}${error.data.requestId ? ` (${error.data.requestId})` : ""}`
      : `Falha HTTP ${response.status}. Recarregue o portal para conferir o estado salvo.`);
  }
  const data = responseSchema.parse(body);
  return { version: data.version, state: validateState(data.state) };
}

export class HttpPortalConnection implements PortalConnection {
  readonly initialState;
  private version: number;

  constructor(snapshot: PortalSnapshot) {
    this.initialState = snapshot.state;
    this.version = snapshot.version;
  }

  static async connect() {
    const response = await fetch("/api/v1/portal", { cache: "no-store" });
    return new HttpPortalConnection(await decode(response));
  }

  async execute(command: PortalCommand) {
    let response: Response;
    try {
      response = await fetch("/api/v1/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: this.version, command, commandId: crypto.randomUUID() })
      });
    } catch {
      throw new Error("Conexão interrompida. A alteração pode ter sido salva; recarregue o portal antes de repetir para evitar duplicidade.");
    }
    const snapshot = await decode(response);
    this.version = snapshot.version;
    return snapshot.state;
  }
}
