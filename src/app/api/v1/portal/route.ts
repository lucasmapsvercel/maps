import { z } from "zod";
import { portalCommandSchema } from "../../../../domain/portal-command";
import { authenticatedApi, json, readJson } from "../../../../infrastructure/server/api";
import { mongoClient, mongoDatabase } from "../../../../infrastructure/server/mongo";
import { MongoPortalStore } from "../../../../infrastructure/server/mongo-portal-store";
import { consumeMutationLimit } from "../../../../infrastructure/server/rate-limit";
import { PortalError } from "../../../../application/portal-error";
import { ibgeMunicipalities } from "../../../../infrastructure/server/ibge-municipalities";
import { municipalityCity } from "../../../../domain/municipality";

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
    if (body.command.type === "addSearch") {
      if (!body.command.municipality) throw new PortalError(400, "MUNICIPALITY_REQUIRED", "Selecione um município válido da lista do IBGE.");
      const code = body.command.municipality.ibgeCode;
      const municipality = (await ibgeMunicipalities.list()).find((item) => item.ibgeCode === code);
      if (!municipality) throw new PortalError(400, "MUNICIPALITY_NOT_FOUND", "Município não encontrado no catálogo do IBGE.");
      body.command = { ...body.command, municipality, city: municipalityCity(municipality) };
    }
    return json(await (await store()).execute(actor, body.command, body.version, body.commandId));
  });
}
