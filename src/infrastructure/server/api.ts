import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../application/portal-error";
import { currentActor, type Actor } from "./auth";
import { appOrigin } from "./config";

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function verifyWriteOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin()) {
    throw new PortalError(403, "ORIGIN_DENIED", "Origem da requisição não autorizada.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new PortalError(415, "JSON_REQUIRED", "Envie application/json.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new PortalError(400, "BODY_REQUIRED", "Corpo JSON obrigatório.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new PortalError(413, "BODY_TOO_LARGE", "O corpo excede 8 KiB.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new PortalError(400, "INVALID_JSON", "JSON inválido.");
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function authenticatedApi(request: Request, action: (actor: Actor) => Promise<Response>) {
  const requestId = randomUUID();
  try {
    const actor = await currentActor();
    if (!actor) throw new PortalError(401, "UNAUTHENTICATED", "Entre com uma conta Google autorizada.");
    if (request.method !== "GET") verifyWriteOrigin(request);
    return await action(actor);
  } catch (error) {
    if (error instanceof PortalError) return json({ error: error.message, code: error.code, requestId }, error.status);
    if (error instanceof z.ZodError) return json({ error: "Dados inválidos para esta operação.", code: "VALIDATION_ERROR", requestId }, 400);
    console.error(JSON.stringify({ event: "api_failure", requestId, errorType: error instanceof Error ? error.name : "Unknown" }));
    return json({ error: "Serviço indisponível. Tente novamente; se persistir, informe o identificador ao administrador.", code: "UNAVAILABLE", requestId }, 503);
  }
}
