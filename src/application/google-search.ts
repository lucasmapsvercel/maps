import type { GoogleSearchResult } from "../domain/google-search";
import type { GoogleSearchObserver } from "../domain/google-search-details";

export interface GooglePlacesProvider {
  search(term: string, city: string, pageToken?: string, observe?: GoogleSearchObserver): Promise<GoogleSearchResult>;
}
