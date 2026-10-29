import { PortalClient } from "../presentation/portal-client";
import { redirect } from "next/navigation";
import { currentActor } from "../infrastructure/server/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!await currentActor()) redirect("/login");
  return <PortalClient />;
}
