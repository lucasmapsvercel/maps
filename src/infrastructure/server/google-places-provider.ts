import { z } from "zod";
import { PortalError } from "../../application/portal-error";
import type { GooglePlacesProvider } from "../../application/google-search";
import type { GoogleSearchResult } from "../../domain/google-search";
import { GOOGLE_TEXT_SEARCH_PAGE_SIZE } from "../../domain/collection-config";

const responseSchema = z.object({
  places: z.array(z.object({
    id: z.string().min(1).max(500),
    displayName: z.object({ text: z.string().max(1000) }).optional(),
    formattedAddress: z.string().max(2000).optional(),
    location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional(),
    primaryType: z.string().max(200).optional(),
    nationalPhoneNumber: z.string().max(60).optional(),
    websiteUri: z.string().max(500).optional(),
    attributions: z.array(z.object({
      provider: z.string().max(500),
      providerUri: z.url().refine((value) => new URL(value).protocol === "https:").optional()
    })).optional()
  })).max(GOOGLE_TEXT_SEARCH_PAGE_SIZE).optional(),
  nextPageToken: z.string().optional()
});

export class GoogleTextSearchProvider implements GooglePlacesProvider {
  constructor(private readonly apiKey: string, private readonly transport: typeof fetch = fetch) {}

  async search(term: string, city: string, pageToken?: string): Promise<GoogleSearchResult> {
    let response: Response;
    try {
      response = await this.transport("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.nationalPhoneNumber,places.websiteUri,places.attributions,nextPageToken"
        },
        body: JSON.stringify({
          textQuery: `${term} em ${city}`, languageCode: "pt-BR", regionCode: "BR", pageSize: GOOGLE_TEXT_SEARCH_PAGE_SIZE,
          ...(pageToken ? { pageToken } : {})
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        redirect: "error"
      });
    } catch {
      throw new PortalError(502, "GOOGLE_CONNECTION_FAILED",
        "A consulta ao Google falhou ou excedeu o tempo limite. A tentativa permanece contabilizada; não há repetição automática.");
    }
    if (!response.ok) {
      throw new PortalError(response.status === 429 ? 429 : 502, "GOOGLE_REQUEST_FAILED",
        response.status === 429 ? "Cota do Google atingida. A tentativa foi contabilizada."
          : "O Google recusou a consulta. Verifique a chave, APIs e faturamento no console; a tentativa foi contabilizada.");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PortalError(502, "GOOGLE_INVALID_RESPONSE", "Resposta inválida do Google; tentativa contabilizada.");
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new PortalError(502, "GOOGLE_INVALID_RESPONSE", "Resposta incompatível do Google; tentativa contabilizada.");
    return {
      places: (parsed.data.places || []).map((place) => ({
        id: place.id, name: place.displayName?.text || "Nome não informado",
        address: place.formattedAddress || "Endereço não informado",
        category: place.primaryType || "",
        latitude: place.location?.latitude, longitude: place.location?.longitude,
        phone: place.nationalPhoneNumber,
        website: place.websiteUri,
        attributions: place.attributions || []
      })),
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      limited: Boolean(parsed.data.nextPageToken) || parsed.data.places?.length === GOOGLE_TEXT_SEARCH_PAGE_SIZE,
      nextPageToken: parsed.data.nextPageToken
    };
  }
}
