"use client";
import { useEffect, useRef } from "react";
import type { Place } from "../../domain/types";

interface MapMarker {
  id: string;
  place: Place;
  selected: boolean;
}

interface Props {
  markers: MapMarker[];
  onSelect: (id: string) => void;
}

declare global {
  interface Window {
    L: typeof import("leaflet");
  }
}

export function MapView({ markers, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    async function init() {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      // Corrigir path dos ícones do Leaflet no webpack/Next
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png"
      });

      const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(map);
      mapRef.current = map;
      window.L = L;
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Sincronizar marcadores quando markers muda
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const L = window.L;
    if (!L) return;

    const currentIds = new Set(markers.map((m) => m.id));

    // Remover marcadores que saíram
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    const validMarkers = markers.filter((m) => m.place.latitude !== undefined && m.place.longitude !== undefined);

    // Adicionar ou atualizar marcadores
    for (const m of validMarkers) {
      const lat = m.place.latitude!;
      const lng = m.place.longitude!;
      let marker = markersRef.current.get(m.id);
      if (!marker) {
        marker = L.marker([lat, lng])
          .addTo(map)
          .on("click", () => onSelectRef.current(m.id));
        markersRef.current.set(m.id, marker);
      }
      const opacity = m.selected ? 1 : 0.7;
      marker.setOpacity(opacity);
      marker.bindPopup(`<strong>${m.place.name}</strong><br/>${m.place.address}`);
    }

    // Ajustar viewport para cobrir todos os marcadores
    if (validMarkers.length > 0) {
      const bounds = L.latLngBounds(validMarkers.map((m) => [m.place.latitude!, m.place.longitude!]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [markers]);

  // Abrir popup do marcador selecionado
  useEffect(() => {
    const selected = markers.find((m) => m.selected);
    if (!selected) return;
    const marker = markersRef.current.get(selected.id);
    if (marker) marker.openPopup();
  }, [markers]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 360 }} aria-label="Mapa de estabelecimentos" />;
}
