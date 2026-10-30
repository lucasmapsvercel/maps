import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../styles.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "MAPS — Pesquisa local",
  description: "Portal de pesquisa e organização de estabelecimentos por busca e município."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
