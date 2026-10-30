import type { GoogleSearchResult } from "../domain/google-search";

export interface GooglePlacesProvider {
  search(term: string, city: string): Promise<GoogleSearchResult>;
}
