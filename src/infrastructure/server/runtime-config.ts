import { PortalError } from "../../application/portal-error";

export function validateCollectionRequest(env: Record<string, string | undefined>): void {
  const enabled = env.GOOGLE_COLLECTION_ENABLED;
  if (enabled !== undefined && enabled !== "true" && enabled !== "false") {
    throw new PortalError(503, "COLLECTION_CONFIGURATION_INVALID",
      "Configuração inválida de coleta: GOOGLE_COLLECTION_ENABLED deve ser true ou false.");
  }
  if (enabled !== "true") {
    throw new PortalError(409, "COLLECTION_DISABLED", "A coleta externa está desativada neste ambiente.");
  }
  if (!env.GOOGLE_PLACES_API_KEY?.trim() || env.GOOGLE_PLACES_POLICY_ACKNOWLEDGED !== "true") {
    throw new PortalError(409, "COLLECTION_NOT_CONFIGURED",
      "Configure a chave Places e confirme a revisão das políticas de uso e privacidade antes de consultar.");
  }
  const limit = env.GOOGLE_PLACES_MONTHLY_LIMIT || "0";
  if (!/^[0-9]+$/.test(limit) || Number(limit) > 5000) {
    throw new PortalError(503, "COLLECTION_CONFIGURATION_INVALID",
      "GOOGLE_PLACES_MONTHLY_LIMIT deve ser um inteiro entre 0 e 5000.");
  }
  if (Number(limit) === 0 || !env.GOOGLE_PLACES_BILLING_SCOPE?.trim()) {
    throw new PortalError(409, "COLLECTION_BUDGET_REQUIRED",
      "Defina a parcela da franquia disponível para este portal e o identificador do orçamento compartilhado. Nenhuma chamada foi realizada.");
  }
}
