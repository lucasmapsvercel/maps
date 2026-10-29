"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function LoginClient({ hasError }: { hasError: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(hasError ? "Não foi possível entrar. Use uma conta Google autorizada pelo administrador." : "");
  return <main className="page-card login-card"><span className="eyebrow">MAPS</span>
    <h1>Entre no seu workspace</h1>
    <p>Somente contas Google verificadas e autorizadas podem acessar os dados.</p>
    {error && <p role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending} onClick={async () => {
      setPending(true);
      setError("");
      try {
        await signIn("google", { callbackUrl: "/" });
      } catch {
        setError("Falha ao iniciar o login. Verifique a conexão e tente novamente.");
        setPending(false);
      }
    }}>{pending ? "Redirecionando..." : "Entrar com Google"}</button>
    <p className="footer-note">A coleta de estabelecimentos permanece bloqueada até a configuração de uma fonte autorizada.</p>
  </main>;
}
