import NextAuth from "next-auth";
import { authOptions } from "../../../../infrastructure/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (request: Request, context: { params: Promise<{ nextauth: string[] }> }) =>
  NextAuth(authOptions())(request, context);

export { handler as GET, handler as POST };
