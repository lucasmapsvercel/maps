import type { Place } from "./types";

interface GoogleSearchPlace extends Omit<Place, "category"> {
  category?: string;
  attributions: Array<{ provider: string; providerUri?: string }>;
}

export interface GoogleSearchResult {
  places: GoogleSearchPlace[];
  expiresAt: string;
  limited: boolean;
  nextPageToken?: string;
}
