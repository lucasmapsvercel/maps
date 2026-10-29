"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="page-card"><h1>Portal indisponível</h1>
    <p role="alert">Não foi possível abrir o portal. Peça ao administrador para verificar a configuração do servidor e a disponibilidade do banco.</p>
    <button className="button button-primary" onClick={reset}>Tentar novamente</button>
  </main>;
}
