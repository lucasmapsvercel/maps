import { PortalError } from "../../application/portal-error";

export function validateCollectionRequest(env: Record<string, string | undefined>): never {
  const enabled = env.GOOGLE_COLLECTION_ENABLED;
  if (enabled !== undefined && enabled !== "true" && enabled !== "false") {
    throw new PortalError(503, "COLLECTION_CONFIGURATION_INVALID",
      "Configuração inválida de coleta: GOOGLE_COLLECTION_ENABLED deve ser true ou false.");
  }
  if (enabled !== "true") {
    throw new PortalError(409, "COLLECTION_DISABLED", "A coleta externa está desativada neste ambiente.");
  }
  throw new PortalError(409, "COLLECTION_NOT_CONFIGURED",
    "Coleta bloqueada: a integração ainda não está implementada. Defina uma fonte autorizada, política de retenção e limites de requisições e custo antes da integração.");
}
