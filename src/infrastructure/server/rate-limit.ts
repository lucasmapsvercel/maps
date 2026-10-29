import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { PortalError } from "../../application/portal-error";
import type { Actor } from "./auth";

export async function consumeMutationLimit(db: Db, actor: Actor, now = Date.now()) {
  const minute = Math.floor(now / 60000);
  const identity = createHash("sha256").update(`${actor.workspaceId}:${actor.userId}:${minute}`).digest("hex");
  const result = await db.collection<{ _id: string; count: number; expiresAt: Date }>("apiRateLimits").findOneAndUpdate(
    { _id: identity },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((minute + 2) * 60000) } },
    { upsert: true, returnDocument: "after" }
  );
  if (!result) throw new Error("Não foi possível reservar o limite de requisições.");
  if (result.count > 300) {
    throw new PortalError(429, "RATE_LIMITED", "Limite de 300 alterações por minuto atingido. Aguarde o próximo minuto.");
  }
}
