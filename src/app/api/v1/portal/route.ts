import { z } from "zod";
import { portalCommandSchema } from "../../../../domain/portal-command";
import { authenticatedApi, json, readJson } from "../../../../infrastructure/server/api";
import { mongoClient, mongoDatabase } from "../../../../infrastructure/server/mongo";
import { MongoPortalStore } from "../../../../infrastructure/server/mongo-portal-store";
import { consumeMutationLimit } from "../../../../infrastructure/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.strictObject({ version: z.number().int().nonnegative(), command: portalCommandSchema, commandId: z.uuid() });

async function store() {
  return new MongoPortalStore(await mongoClient(), await mongoDatabase());
}

export function GET(request: Request) {
  return authenticatedApi(request, async (actor) => json(await (await store()).load(actor)));
}

export function POST(request: Request) {
  return authenticatedApi(request, async (actor) => {
    const body = bodySchema.parse(await readJson(request));
    await consumeMutationLimit(await mongoDatabase(), actor);
    return json(await (await store()).execute(actor, body.command, body.version, body.commandId));
  });
}
