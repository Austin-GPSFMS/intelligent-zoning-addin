/**
 * Leaflet map of the suggested zones: a circle per suggestion sized to its
 * import radius, a rank pin, and a sampled scatter of the raw stops.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Suggestion } from "../types";
import { formatDuration } from "../utils/format";

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface SuggestionMapProps {
  suggestions: Suggestion[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

function colorFor(c: Suggestion): string {
  if (c.imported) return "#16a34a";
  if (c.score >= 60) return "#dc2626";
  if (c.score >= 30) return "#f59e0b";
  return "#0084c2";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch
  );
}

function tooltipFor(c: Suggestion): string {
  return (
    `<b>#${c.rank} ${escapeHtml(c.name)}</b><br>` +
    `${c.kind} · score ${c.score}<br>` +
    `${c.stopCount} stops · ${c.vehicleCount} vehicles · ${c.dayCount} days<br>` +
    `avg dwell ${formatDuration(c.avgDwellMs)}`
  );
}

export function SuggestionMap({ suggestions, activeId, onSelect }: SuggestionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const circlesRef = useRef<Map<string, L.Circle>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { preferCanvas: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.setView([39.5, -98.35], 4);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw when suggestions change (geometry, radius edits, imports).
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    circlesRef.current.clear();
    if (!suggestions.length) return;

    const bounds: L.LatLngTuple[] = [];
    for (const c of suggestions) {
      const color = colorFor(c);
      const circle = L.circle([c.lat, c.lng], {
        radius: c.radius,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.18,
      }).addTo(layer);
      circle.bindTooltip(tooltipFor(c));
      circle.on("click", () => onSelectRef.current(c.id));
      circlesRef.current.set(c.id, circle);

      const pin = L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: "iz-pin",
          html: `<span>${c.rank}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).addTo(layer);
      pin.on("click", () => onSelectRef.current(c.id));

      // Sampled raw stops so dense yards don't paint the map solid.
      const step = Math.max(1, Math.floor(c.stops.length / 60));
      for (let i = 0; i < c.stops.length; i += step) {
        L.circleMarker([c.stops[i].lat, c.stops[i].lng], {
          radius: 2,
          color,
          weight: 0,
          fillOpacity: 0.5,
          interactive: false,
        }).addTo(layer);
      }
      bounds.push([c.lat, c.lng]);
    }
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    setTimeout(() => map.invalidateSize(), 50);
    // Only re-fit when the set of suggestions or their radii change.
  }, [suggestions]);

  // Fly to the active suggestion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeId) return;
    const c = suggestions.find((s) => s.id === activeId);
    if (!c) return;
    map.setView([c.lat, c.lng], 17);
    circlesRef.current.get(activeId)?.openTooltip();
  }, [activeId, suggestions]);

  return <div ref={containerRef} className="iz-map" />;
}
