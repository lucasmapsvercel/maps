import catalogData from "../data/ibge-neighborhoods.json";
import { neighborhoodCatalogSchema } from "../ibge-neighborhood-catalog";
import type { SavedSearch } from "../../domain/types";
import type { CollectionCoverage } from "../../domain/collection-coverage";

const catalog = neighborhoodCatalogSchema.parse(catalogData);

export function neighborhoodPlan(search: SavedSearch) {
  const names = new Set<string>();
  const neighborhoods = search.municipality ? catalog.municipalities[search.municipality.ibgeCode]?.filter((area) => {
    const name = area.name.normalize("NFC").toLocaleLowerCase("pt-BR");
    if (names.has(name)) return false;
    names.add(name);
    return true;
  }) : undefined;
  const coverage: CollectionCoverage = neighborhoods ? {
    mode: "neighborhoods", total: neighborhoods.length, completed: 0,
    current: neighborhoods[0].name, catalogDate: String(catalog.referenceYear)
  } : { mode: "municipality", total: 0, completed: 0, reason: "catalog_unavailable" };
  return { coverage, ...(neighborhoods ? { neighborhoods } : {}) };
}
