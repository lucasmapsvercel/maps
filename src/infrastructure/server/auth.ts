import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { allowedEmails, appOrigin, secret, workspaceId } from "./config";

export interface Actor {
  userId: string;
  workspaceId: string;
  name: string;
}

export function authOptions(): NextAuthOptions {
  appOrigin();
  return {
    secret: secret("NEXTAUTH_SECRET"),
    providers: [GoogleProvider({
      clientId: secret("GOOGLE_CLIENT_ID"),
      clientSecret: secret("GOOGLE_CLIENT_SECRET"),
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } }
    })],
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    pages: { signIn: "/login", error: "/login" },
    logger: {
      error(code) { console.error(JSON.stringify({ event: "auth_error", code })); },
      warn(code) { console.warn(JSON.stringify({ event: "auth_warning", code })); },
      debug() {}
    },
    callbacks: {
      async signIn({ account, profile }) {
        return account?.provider === "google" && profile?.email_verified === true
          && typeof profile.email === "string" && allowedEmails().has(profile.email.toLowerCase());
      },
      async jwt({ token, account }) {
        if (account) token.sub = account.providerAccountId;
        return token;
      },
      async session({ session, token }) {
        if (session.user && token.sub) session.user.id = token.sub;
        return session;
      },
      async redirect({ url }) {
        const origin = appOrigin();
        return new URL(url, origin).origin === origin ? new URL(url, origin).href : origin;
      }
    }
  };
}

export async function currentActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions());
  const user = session?.user;
  if (!user?.id || !user.email || !allowedEmails().has(user.email.toLowerCase())) return null;
  return { userId: user.id, workspaceId: workspaceId(), name: user.name || user.email };
}
