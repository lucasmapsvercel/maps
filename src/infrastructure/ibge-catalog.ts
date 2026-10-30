import { z } from "zod";
import { municipalitySchema } from "../domain/municipality.ts";

export const IBGE_MUNICIPALITIES_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome";

const stateSchema = z.object({ sigla: municipalitySchema.shape.stateCode, nome: z.string().min(1) });
const ibgeSchema = z.array(z.object({
  id: z.number().int(),
  nome: z.string().min(1),
  microrregiao: z.object({ mesorregiao: z.object({ UF: stateSchema }) }).nullish(),
  "regiao-imediata": z.object({ "regiao-intermediaria": z.object({ UF: stateSchema }) }).nullish()
})).min(1).max(10000);

const completeCatalogSchema = z.array(municipalitySchema).min(5500).max(10000)
  .refine((items) => new Set(items.map((item) => item.ibgeCode)).size === items.length, "Codigos IBGE duplicados.")
  .refine((items) => new Set(items.map((item) => item.stateCode)).size === municipalitySchema.shape.stateCode.options.length,
    "O catalogo deve incluir as 27 UFs.");

export function parseIbgeMunicipalities(payload: unknown) {
  return completeCatalogSchema.parse(ibgeSchema.parse(payload).map((item) => {
    const state = item["regiao-imediata"]?.["regiao-intermediaria"].UF ?? item.microrregiao?.mesorregiao.UF;
    return municipalitySchema.parse({
      ibgeCode: String(item.id), name: item.nome, stateCode: state?.sigla, stateName: state?.nome, country: "Brasil"
    });
  }));
}
