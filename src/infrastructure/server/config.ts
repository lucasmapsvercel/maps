import { z } from "zod";

export function secret(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Configure ${name} nas variáveis de ambiente do servidor.`);
  return value;
}

export function appOrigin(): string {
  const url = new URL(z.url().parse(process.env.NEXTAUTH_URL));
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("NEXTAUTH_URL deve conter somente a origem pública do portal.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Use HTTPS; HTTP somente em localhost ou 127.0.0.1.");
  }
  return url.origin;
}

export function allowedEmails(): Set<string> {
  const values = (process.env.AUTH_ALLOWED_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!values.length || values.some((email) => !z.email().safeParse(email).success)) {
    throw new Error("Configure AUTH_ALLOWED_EMAILS com os e-mails autorizados, separados por vírgula.");
  }
  return new Set(values);
}

export function workspaceId(): string {
  return z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).parse(process.env.PORTAL_WORKSPACE_ID || "maps");
}

export function databaseName(): string {
  return z.string().regex(/^[a-zA-Z0-9_-]{1,63}$/).parse(process.env.MONGODB_DB_NAME || "MAPS");
}

export function mongoUri(): string {
  const uri = secret("MONGODB_URI");
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error("MONGODB_URI deve ser uma URI MongoDB válida.");
  return uri;
}

export function validateServerConfig() {
  appOrigin();
  allowedEmails();
  workspaceId();
  databaseName();
  mongoUri();
  if (secret("NEXTAUTH_SECRET").length < 32) throw new Error("NEXTAUTH_SECRET deve ter pelo menos 32 caracteres aleatórios.");
  secret("GOOGLE_CLIENT_ID");
  secret("GOOGLE_CLIENT_SECRET");
}
