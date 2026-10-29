import { LoginClient } from "../../presentation/login-client";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return <LoginClient hasError={Boolean(params.error)} />;
}
