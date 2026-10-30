import type { ReactNode } from "react";
import { signOut } from "next-auth/react";
import type { Page } from "../../domain/types";
import type { Portal } from "../use-portal";
import { Notice } from "./common";

export const pageLabels: Record<Page, string> = {
  dashboard: "Visão geral", saved: "Buscas salvas", favorites: "Favoritos", settings: "Configurações"
};
const icons: Record<Page, string> = { dashboard: "⌂", saved: "▤", favorites: "☆", settings: "⚙" };

export function Layout({ portal, children }: { portal: Portal; children: ReactNode }) {
  const { state, mutate } = portal;
  const navigate = (page: Page) => mutate({ type: "navigate", page });
  const nav = (page: Page) => <button key={page} className={`nav-link${state.page === page ? " is-active" : ""}`}
    aria-label={pageLabels[page]} aria-current={state.page === page ? "page" : undefined} onClick={() => navigate(page)}>
    <span className="nav-icon" aria-hidden="true">{icons[page]}</span>{pageLabels[page]}
    {page === "saved" && <span className="nav-count">{state.searches.length}</span>}
  </button>;
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navegação principal">
      <a className="brand" href="#" aria-label="MAPS, início" onClick={(event) => { event.preventDefault(); navigate("dashboard"); }}>
        <span className="brand-mark" aria-hidden="true">M</span>
        <span className="brand-copy"><strong>maps</strong><small>inteligência local</small></span>
      </a>
      <div className="workspace-label">ESPAÇO DE TRABALHO</div>
      <div className="workspace-switcher" aria-label="Espaço de trabalho atual">
        <span className="workspace-avatar">O</span><span className="workspace-copy"><strong>Operação Brasil</strong><small>{portal.remote ? "Workspace compartilhado" : "Workspace demonstrativo"}</small></span>
      </div>
      <nav className="nav-group" aria-label="Páginas"><div className="nav-heading">MENU</div>
        {nav("dashboard")}{nav("saved")}{nav("favorites")}
      </nav>
      <div className="sidebar-bottom">{nav("settings")}
        <div className="profile-card"><span className="profile-avatar">M</span><span className="profile-copy"><strong>{portal.remote ? "Conta Google" : "Demo MAPS"}</strong><small>{portal.remote ? "Acesso autorizado" : "Ambiente local"}</small></span></div>
        {portal.remote && <button className="button button-quiet" onClick={() => signOut({ callbackUrl: "/login" })}>Sair da conta</button>}
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{pageLabels[state.page]}</strong></div>
        <div className="topbar-actions"><span className="demo-pill"><span className="status-dot" />{portal.remote ? "CONSULTAS SOB DEMANDA" : "MODO DEMONSTRATIVO"}</span>
          <button className="icon-button help-button" aria-label="Sobre o portal" title="Sobre o portal" onClick={() => navigate("settings")}>?</button>
        </div>
      </header>
      <div aria-live="polite"><Notice notice={portal.notice} />
        {portal.pending > 0 && <p role="status">Salvando no servidor...</p>}
      </div>
      <section>{children}</section>
    </main>
  </div>;
}
