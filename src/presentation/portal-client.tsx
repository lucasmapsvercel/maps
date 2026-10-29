"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { HttpPortalConnection } from "../infrastructure/http-portal-connection";
import { App } from "./app";

export function PortalClient() {
  const [connection, setConnection] = useState<HttpPortalConnection | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    HttpPortalConnection.connect().then(
      (value) => { if (active) setConnection(value); },
      (failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "Erro ao conectar ao servidor."); }
    );
    return () => { active = false; };
  }, []);

  if (error) return <main className="page-card"><h1>Não foi possível carregar o portal</h1>
    <p role="alert">{error}</p><button className="button button-primary" onClick={() => window.location.reload()}>Tentar novamente</button>
    <button className="button button-quiet" onClick={() => signOut({ callbackUrl: "/login" })}>Sair</button></main>;
  if (!connection) return <main className="page-card" role="status">Carregando o portal MAPS...</main>;
  return <App connection={connection} />;
}
