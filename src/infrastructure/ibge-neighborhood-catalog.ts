import { z } from "zod";

export const IBGE_NEIGHBORHOODS_URL = "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/BR/BR_bairros_CD2022.zip";

export const neighborhoodSchema = z.object({
  code: z.string().regex(/^\d{8,20}$/),
  name: z.string().trim().min(1).max(200)
});

export const neighborhoodCatalogSchema = z.object({
  source: z.literal(IBGE_NEIGHBORHOODS_URL),
  referenceYear: z.literal(2022),
  updatedAt: z.iso.datetime(),
  municipalities: z.record(z.string().regex(/^\d{7}$/), z.array(neighborhoodSchema).min(1).max(5000))
}).superRefine((catalog, ctx) => {
  const entries = Object.entries(catalog.municipalities);
  if (entries.length < 850 || entries.reduce((sum, [, areas]) => sum + areas.length, 0) < 17000) {
    ctx.addIssue({ code: "custom", message: "Catalogo nacional de bairros incompleto." });
  }
  const codes = new Set<string>();
  for (const [municipality, areas] of entries) {
    for (const area of areas) {
      if (!area.code.startsWith(municipality) || codes.has(area.code)) {
        ctx.addIssue({ code: "custom", message: "Codigo de bairro duplicado ou municipio incompativel." });
      }
      codes.add(area.code);
    }
  }
});

export type Neighborhood = z.infer<typeof neighborhoodSchema>;
