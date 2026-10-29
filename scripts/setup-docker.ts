import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

await mkdir(".secrets", { recursive: true, mode: 0o700 });
if (process.platform !== "win32") await chmod(".secrets", 0o700);
for (const name of ["mongo-root-password", "mongodb-password", "mongo-keyfile", "nextauth-secret"]) {
  try {
    await writeFile(join(".secrets", `${name}.txt`),
      randomBytes(name === "mongo-keyfile" ? 512 : 32).toString("hex") + "\n", { flag: "wx", mode: 0o644 });
    console.log(`Criado segredo privado: ${name} (valor omitido).`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    console.log(`Preservado segredo existente: ${name}.`);
  }
  if (process.platform !== "win32") await chmod(join(".secrets", `${name}.txt`), 0o644);
}
try {
  await writeFile(join(".secrets", "google-client-secret.txt"), "", { flag: "wx", mode: 0o644 });
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
}
if (process.platform !== "win32") await chmod(join(".secrets", "google-client-secret.txt"), 0o644);
try {
  await copyFile(".env.example", ".env", constants.COPYFILE_EXCL);
  console.log("Criado .env a partir do exemplo.");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  console.log("Preservado .env existente; adicione as novas variaveis do exemplo.");
}
console.log("Configure GOOGLE_CLIENT_ID, AUTH_ALLOWED_EMAILS e NEXTAUTH_URL no .env.");
console.log("Grave o client secret do Google em .secrets/google-client-secret.txt. Nao envie segredos no chat.");
