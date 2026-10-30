import { z } from "zod";

export const municipalitySchema = z.strictObject({
  ibgeCode: z.string().regex(/^\d{7}$/),
  name: z.string().min(1).max(200),
  stateCode: z.enum(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]),
  stateName: z.string().min(1).max(100),
  country: z.literal("Brasil")
});

export type Municipality = z.infer<typeof municipalitySchema>;
export const municipalitiesResponseSchema = z.object({
  municipalities: z.array(municipalitySchema).min(1).max(10000),
  source: z.enum(["ibge", "backup"]),
  updatedAt: z.iso.datetime()
});

export type MunicipalityCatalog = z.infer<typeof municipalitiesResponseSchema>;

export function municipalityCity(municipality: Municipality) {
  return `${municipality.name}, ${municipality.stateName}, ${municipality.country}`;
}

export function municipalityLabel(municipality: Municipality) {
  return `${municipality.name} — ${municipality.stateCode}`;
}

export function filterMunicipalities(municipalities: Municipality[], query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const words = normalize(query).split(/[\s,\u2013\u2014-]+/).filter(Boolean);
  if (!words.length) return [];
  return municipalities.filter((municipality) => {
    const text = normalize(`${municipality.name} ${municipality.stateCode} ${municipality.stateName}`);
    return words.every((word) => text.includes(word));
  });
}
