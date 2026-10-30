"use client";
import { useEffect, useRef, useState } from "react";
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

export function MapView({ markers, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<{ map: import("leaflet").Map; L: typeof import("leaflet") } | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let activeMap: import("leaflet").Map | undefined;
    const leafletMarkers = markersRef.current;

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
      activeMap = map;
      setInstance({ map, L });
    }

    init();
    return () => { cancelled = true; activeMap?.remove(); leafletMarkers.clear(); };
  }, []);

  useEffect(() => {
    if (!instance) return;
    const { map, L } = instance;
    let boundsChanged = false;

    const currentIds = new Set(markers.map((m) => m.id));

    // Remover marcadores que saíram
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
        boundsChanged = true;
      }
    }

    const validMarkers = markers.filter((m) => m.place.latitude !== undefined && m.place.longitude !== undefined);

    // Adicionar ou atualizar marcadores
    for (const m of validMarkers) {
      const lat = m.place.latitude!;
      const lng = m.place.longitude!;
      let marker = markersRef.current.get(m.id);
      if (!marker) {
        marker = L.marker([lat, lng], { title: m.place.name, alt: m.place.name })
          .addTo(map)
          .on("click", () => onSelectRef.current(m.id));
        markersRef.current.set(m.id, marker);
        boundsChanged = true;
      } else {
        const previous = marker.getLatLng();
        if (previous.lat !== lat || previous.lng !== lng) {
          marker.setLatLng([lat, lng]);
          boundsChanged = true;
        }
      }
      const opacity = m.selected ? 1 : 0.7;
      marker.setOpacity(opacity);
      marker.setZIndexOffset(m.selected ? 1000 : 0);
      marker.getElement()?.setAttribute("aria-pressed", String(m.selected));
    }

    // Ajustar viewport para cobrir todos os marcadores
    if (boundsChanged && validMarkers.length > 0) {
      const bounds = L.latLngBounds(validMarkers.map((m) => [m.place.latitude!, m.place.longitude!]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [markers, instance]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 360 }} aria-label="Mapa de estabelecimentos" />;
}
