import { z } from "zod";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
  .refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
const filters = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("searchFilter"), value: z.string().max(200) }),
  z.strictObject({ name: z.literal("visibility"), value: z.enum(["visible", "hidden", "all"]) }),
  z.strictObject({ name: z.literal("favoriteOnly"), value: z.boolean() }),
  z.strictObject({ name: z.literal("mobileView"), value: z.enum(["map", "list"]) })
]);

const importedPlace = z.strictObject({
  id: z.string().min(1).max(500).regex(/^[a-zA-Z0-9_:-]+$/),
  name: z.string().min(1).max(1000),
  address: z.string().max(2000),
  category: z.string().max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().max(60).optional(),
  website: z.string().max(200).optional()
});

export const portalCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("addSearch"), term: z.string().trim().min(2).max(200), city: z.string().trim().min(1).max(200) }),
  z.strictObject({ type: z.literal("openSearch"), id }),
  z.strictObject({ type: z.literal("closeTab"), id }),
  z.strictObject({ type: z.literal("navigate"), page: z.enum(["dashboard", "saved", "favorites", "settings"]) }),
  z.strictObject({ type: z.literal("toggleFavorite"), id }),
  z.strictObject({ type: z.literal("toggleHidden"), id }),
  z.strictObject({ type: z.literal("addComment"), id, text: z.string().trim().min(1).max(500) }),
  z.strictObject({ type: z.literal("editPlace"), id, phone: z.string().max(60), website: z.string().max(200) }),
  z.strictObject({ type: z.literal("clearOverrides"), id }),
  z.strictObject({ type: z.literal("setFilter"), filter: filters }),
  z.strictObject({ type: z.literal("importPlaces"), searchId: id, places: z.array(importedPlace).max(20) })
]);

export type PortalCommand = z.infer<typeof portalCommandSchema>;

export function isViewCommand(command: PortalCommand) {
  return ["navigate", "openSearch", "closeTab", "setFilter"].includes(command.type);
}
