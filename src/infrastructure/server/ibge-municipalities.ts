import { z } from "zod";
import { PortalError } from "../../application/portal-error";
import { municipalitySchema, type Municipality } from "../../domain/municipality";

const stateSchema = z.object({ sigla: municipalitySchema.shape.stateCode, nome: z.string().min(1) });
const ibgeSchema = z.array(z.object({
  id: z.number().int(),
  nome: z.string().min(1),
  microrregiao: z.object({ mesorregiao: z.object({ UF: stateSchema }) }).nullish(),
  "regiao-imediata": z.object({ "regiao-intermediaria": z.object({ UF: stateSchema }) }).nullish()
})).min(1).max(10000);

export class IbgeMunicipalities {
  private cached?: { municipalities: Municipality[]; expiresAt: number };
  private pending?: Promise<Municipality[]>;

  constructor(private readonly transport: typeof fetch = fetch) {}

  async list(): Promise<Municipality[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.municipalities;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try {
      const municipalities = await this.pending;
      this.cached = { municipalities, expiresAt: Date.now() + 86400_000 };
      return municipalities;
    } finally {
      this.pending = undefined;
    }
  }

  private async load(): Promise<Municipality[]> {
    let response: Response;
    try {
      response = await this.transport("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome", {
        cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error"
      });
    } catch {
      throw new PortalError(502, "IBGE_UNAVAILABLE", "Não foi possível consultar os municípios do IBGE. Tente novamente.");
    }
    if (!response.ok) throw new PortalError(502, "IBGE_UNAVAILABLE", "O catálogo de municípios do IBGE está indisponível. Tente novamente.");
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new PortalError(502, "IBGE_INVALID_RESPONSE", "O IBGE retornou um catálogo inválido. Tente novamente.");
    }
    const parsed = ibgeSchema.safeParse(payload);
    if (!parsed.success) throw new PortalError(502, "IBGE_INVALID_RESPONSE", "O formato do catálogo do IBGE é incompatível.");
    return parsed.data.map((item) => {
      const state = item["regiao-imediata"]?.["regiao-intermediaria"].UF ?? item.microrregiao?.mesorregiao.UF;
      const municipality = municipalitySchema.safeParse({
        ibgeCode: String(item.id), name: item.nome, stateCode: state?.sigla, stateName: state?.nome, country: "Brasil"
      });
      if (!municipality.success) throw new PortalError(502, "IBGE_INVALID_RESPONSE", "O catálogo do IBGE contém um município sem identificação válida.");
      return municipality.data;
    });
  }
}

export const ibgeMunicipalities = new IbgeMunicipalities();
