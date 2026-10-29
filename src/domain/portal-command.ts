import { z } from "zod";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
  .refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
const filters = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("searchFilter"), value: z.string().max(200) }),
  z.strictObject({ name: z.literal("visibility"), value: z.enum(["visible", "hidden", "all"]) }),
  z.strictObject({ name: z.literal("favoriteOnly"), value: z.boolean() }),
  z.strictObject({ name: z.literal("mobileView"), value: z.enum(["map", "list"]) })
]);

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
  z.strictObject({ type: z.literal("setFilter"), filter: filters })
]);

export type PortalCommand = z.infer<typeof portalCommandSchema>;

export function isViewCommand(command: PortalCommand) {
  return ["navigate", "openSearch", "closeTab", "setFilter"].includes(command.type);
}
