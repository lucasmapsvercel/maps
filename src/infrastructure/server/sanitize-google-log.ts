import type { z } from "zod";

type Json = z.infer<ReturnType<typeof z.json>>;
const sensitiveField = /^(?:key)$|token|api[-_]?key|authorization|cookie|secret|password|credential/i;

export function sanitizeGoogleLog(value: unknown, secrets: string[]): Json {
  const hidden = new Set(secrets.filter(Boolean));
  function collect(input: unknown) {
    if (!input || typeof input !== "object") return;
    for (const [key, item] of Object.entries(input)) {
      if (sensitiveField.test(key) && typeof item === "string" && item) hidden.add(item);
      else if (item && typeof item === "object") collect(item);
    }
  }
  collect(value);
  return sanitize(value, [...hidden]);
}

function sanitize(value: unknown, secrets: string[]): Json {
  if (typeof value === "string") {
    let sanitized = value;
    for (const secret of secrets.filter(Boolean)) sanitized = sanitized.split(secret).join("[REDACTED]");
    return sanitized.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
      .replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]")
      .replace(/((?:key|token|api[-_]?key|authorization|password|secret|credential)[\w-]*["']?\s*[:=]\s*["']?)[^"'\s&,}]+/gi, "$1[REDACTED]");
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, sensitiveField.test(key) ? "[REDACTED]" : sanitize(item, secrets)
    ]));
  }
  return null;
}
