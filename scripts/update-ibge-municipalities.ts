import { mkdir, writeFile } from "node:fs/promises";
import { IBGE_MUNICIPALITIES_URL, parseIbgeMunicipalities } from "../src/infrastructure/ibge-catalog.ts";

const response = await fetch(IBGE_MUNICIPALITIES_URL, {
  signal: AbortSignal.timeout(30000), redirect: "error"
});
if (!response.ok) throw new Error(`IBGE indisponivel: HTTP ${response.status}. Catalogo local preservado.`);
const municipalities = parseIbgeMunicipalities(await response.json());
const states = new Set(municipalities.map((item) => item.stateCode));
const updatedAt = new Date().toISOString();
const content = `{\n  "updatedAt": "${updatedAt}",\n  "municipalities": [\n${
  municipalities.map((item) => `    ${JSON.stringify(item)}`).join(",\n")
}\n  ]\n}\n`;
await mkdir(new URL("../src/infrastructure/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/infrastructure/data/ibge-municipalities.json", import.meta.url), content, "utf8");
console.log(`Catalogo oficial atualizado: ${municipalities.length} municipios, ${states.size} UFs (${updatedAt}).`);
