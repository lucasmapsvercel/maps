export function validateRuntimeConfig(env: Record<string, string | undefined>): void {
  if (env.GOOGLE_COLLECTION_ENABLED && env.GOOGLE_COLLECTION_ENABLED !== "false") {
    throw new Error("A coleta externa não está implementada; GOOGLE_COLLECTION_ENABLED deve permanecer false.");
  }
}
