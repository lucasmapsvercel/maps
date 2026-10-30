import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import {
  IBGE_NEIGHBORHOODS_URL, neighborhoodCatalogSchema, type Neighborhood
} from "../src/infrastructure/ibge-neighborhood-catalog.ts";

const archivePath = process.argv[2];
let archive: Uint8Array;
if (archivePath) {
  archive = await readFile(archivePath);
} else {
  const response = await fetch(IBGE_NEIGHBORHOODS_URL, { signal: AbortSignal.timeout(600000), redirect: "error" });
  if (!response.ok) throw new Error(`IBGE indisponivel: HTTP ${response.status}. Catalogo preservado.`);
  archive = new Uint8Array(await response.arrayBuffer());
}
const files = unzipSync(archive, { filter: (entry) => /\.(dbf|cpg)$/i.test(entry.name) });
const dbfs = Object.entries(files).filter(([name]) => /\.dbf$/i.test(name));
if (dbfs.length !== 1) throw new Error("Esperado um unico DBF nacional de bairros.");
const [filename, bytes] = dbfs[0];
const encoding = new TextDecoder().decode(files[filename.replace(/\.dbf$/i, ".cpg")] ?? new TextEncoder().encode("UTF-8")).trim();
const decoder = new TextDecoder(encoding, { fatal: true });
const data = Buffer.from(bytes);
const records = data.readUInt32LE(4);
const headerLength = data.readUInt16LE(8);
const recordLength = data.readUInt16LE(10);
if (headerLength + records * recordLength > data.length) throw new Error("DBF truncado.");
const fields = new Map<string, { offset: number; length: number }>();
let offset = 1;
for (let index = 32; index < headerLength - 1; index += 32) {
  const name = data.subarray(index, index + 11).toString("ascii").replace(/\0.*$/, "");
  const length = data[index + 16];
  fields.set(name, { offset, length });
  offset += length;
}
if (offset !== recordLength) throw new Error("Layout DBF incompativel.");
function value(record: Buffer, name: string) {
  const field = fields.get(name);
  if (!field) throw new Error(`Campo obrigatorio ausente: ${name}`);
  return decoder.decode(record.subarray(field.offset, field.offset + field.length)).trim();
}
const municipalities: Record<string, Neighborhood[]> = {};
const codes = new Set<string>();
for (let index = 0; index < records; index++) {
  const record = data.subarray(headerLength + index * recordLength, headerLength + (index + 1) * recordLength);
  if (record[0] === 0x2a) continue;
  const municipality = value(record, "CD_MUN");
  const code = value(record, "CD_BAIRRO");
  if (codes.has(code)) throw new Error(`Codigo repetido no DBF: ${code}`);
  codes.add(code);
  (municipalities[municipality] ??= []).push({ code, name: value(record, "NM_BAIRRO") });
}
for (const areas of Object.values(municipalities)) areas.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.code.localeCompare(b.code));
const catalog = neighborhoodCatalogSchema.parse({
  source: IBGE_NEIGHBORHOODS_URL, referenceYear: 2022, updatedAt: new Date().toISOString(),
  municipalities: Object.fromEntries(Object.entries(municipalities).sort(([a], [b]) => a.localeCompare(b)))
});
const destination = new URL("../src/infrastructure/data/ibge-neighborhoods.json", import.meta.url);
await writeFile(destination, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Catalogo IBGE 2022: ${codes.size} bairros em ${Object.keys(municipalities).length} municipios. Belem: ${municipalities["1501402"]?.length ?? 0}.`);
