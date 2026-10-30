import { z } from "zod";
import { PortalError } from "../../application/portal-error";
import { municipalitiesResponseSchema, type Municipality, type MunicipalityCatalog } from "../../domain/municipality";
import { IBGE_MUNICIPALITIES_URL, parseIbgeMunicipalities } from "../ibge-catalog";
import backup from "../data/ibge-municipalities.json";

const backupCatalog = municipalitiesResponseSchema.parse({ ...backup, source: "backup" });

export class IbgeMunicipalities {
  private cached?: { catalog: MunicipalityCatalog; expiresAt: number };
  private pending?: Promise<MunicipalityCatalog>;

  constructor(private readonly transport: typeof fetch = fetch) {}

  async list(): Promise<Municipality[]> {
    return (await this.catalog()).municipalities;
  }

  async catalog(): Promise<MunicipalityCatalog> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.catalog;
    if (this.pending) return this.pending;
    this.pending = this.loadCatalog();
    try {
      const catalog = await this.pending;
      this.cached = { catalog, expiresAt: Date.now() + (catalog.source === "ibge" ? 86400_000 : 300_000) };
      return catalog;
    } finally {
      this.pending = undefined;
    }
  }

  private async loadCatalog(): Promise<MunicipalityCatalog> {
    try {
      return { municipalities: await this.load(), source: "ibge", updatedAt: new Date().toISOString() };
    } catch (error) {
      if (!(error instanceof PortalError) || !["IBGE_UNAVAILABLE", "IBGE_INVALID_RESPONSE"].includes(error.code)) throw error;
      const catalog: MunicipalityCatalog = { ...(this.cached?.catalog ?? backupCatalog), source: "backup" };
      console.warn(JSON.stringify({ event: "ibge_catalog_backup", code: error.code, updatedAt: catalog.updatedAt }));
      return catalog;
    }
  }

  private async load(): Promise<Municipality[]> {
    let response: Response;
    try {
      response = await this.transport(IBGE_MUNICIPALITIES_URL, {
        cache: "no-store", signal: AbortSignal.timeout(5000), redirect: "error"
      });
    } catch {
      throw new PortalError(502, "IBGE_UNAVAILABLE", "Não foi possível consultar os municípios do IBGE. Tente novamente.");
    }
    if (!response.ok) throw new PortalError(502, "IBGE_UNAVAILABLE", "O catálogo de municípios do IBGE está indisponível. Tente novamente.");
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new PortalError(502, "IBGE_INVALID_RESPONSE", "O IBGE retornou um catálogo inválido. Tente novamente.");
    }
    try { return parseIbgeMunicipalities(payload); } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      throw new PortalError(502, "IBGE_INVALID_RESPONSE", "O catálogo do IBGE contém dados inválidos ou incompatíveis.");
    }
  }
}

export const ibgeMunicipalities = new IbgeMunicipalities();
