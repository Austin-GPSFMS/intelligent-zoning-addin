/**
 * Scan pipeline: devices → trips (GetFeed) → stops → clusters → scored
 * suggestions → reverse-geocoded names.
 */

import type {
  GeotabApi,
  GeotabDevice,
  PreparedZone,
  ScanMeta,
  ScanProgress,
  ScanSettings,
  Suggestion,
} from "../types";
import { fetchAddresses, fetchStopsViaFeed } from "../api/geotab";
import { findContainingZone } from "./geo";
import {
  classify,
  clusterStops,
  scoreClusters,
  suggestedRadius,
  summarize,
} from "./cluster";
import { formatInt } from "./format";

/** Mirrors the original feature's "first 100 suggested zones". */
export const MAX_SUGGESTIONS = 100;

export interface ScanResult {
  suggestions: Suggestion[];
  meta: ScanMeta;
}

function defaultName(addr: { street?: string; city?: string; formattedAddress?: string }, lat: number, lng: number): string {
  let base = addr.street || addr.city || (addr.formattedAddress ? addr.formattedAddress.split(",")[0] : "");
  if (!base) base = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return base.length > 60 ? base.slice(0, 57) + "…" : base;
}

export async function runScan(
  api: GeotabApi,
  devices: GeotabDevice[],
  existingZones: PreparedZone[],
  settings: ScanSettings,
  dismissed: Record<string, true>,
  onProgress: (p: ScanProgress) => void,
  isCancelled: () => boolean
): Promise<ScanResult> {
  const toMs = Date.now();
  const fromMs = toMs - settings.lookbackDays * 86400000;
  const deviceIds = new Set(devices.map((d) => d.id));
  let excludedInZone = 0;

  onProgress({ phase: "trips", text: "Streaming trips from the database…", pct: null });

  const feed = await fetchStopsViaFeed(
    api,
    deviceIds,
    fromMs,
    settings.minDwellMinutes * 60000,
    (lat, lng) => {
      if (findContainingZone(existingZones, lat, lng)) {
        excludedInZone++;
        return false;
      }
      return true;
    },
    (tripsScanned, stopsKept, page) =>
      onProgress({
        phase: "trips",
        text: `Page ${page}: ${formatInt(tripsScanned)} trips scanned, ${formatInt(stopsKept)} candidate stops outside existing zones`,
        pct: null,
      }),
    isCancelled
  );

  onProgress({
    phase: "cluster",
    text: `Clustering ${formatInt(feed.stops.length)} stops…`,
    pct: 85,
  });
  // Let the progress banner paint before the synchronous crunch.
  await new Promise((r) => setTimeout(r, 30));

  const working = clusterStops(feed.stops, settings.clusterRadius);
  const clusters = working.map(summarize);
  const filtered = clusters.filter(
    (c) =>
      c.stopCount >= settings.minStops &&
      c.vehicleCount >= settings.minVehicles &&
      !dismissed[c.key]
  );
  const scores = scoreClusters(filtered);
  filtered.sort(
    (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || b.stopCount - a.stopCount
  );
  const top = filtered.slice(0, MAX_SUGGESTIONS);

  onProgress({
    phase: "geocode",
    text: `Reverse-geocoding ${top.length} suggested zones…`,
    pct: 92,
  });
  const addrs = await fetchAddresses(api, top);

  const suggestions: Suggestion[] = top.map((c, i) => {
    const a = addrs[i] ?? {};
    return {
      ...c,
      rank: i + 1,
      score: scores.get(c.id) ?? 0,
      kind: classify(c, devices.length),
      name: defaultName(a, c.lat, c.lng),
      address: a.formattedAddress ?? "",
      radius: suggestedRadius(c, settings.clusterRadius),
      selected: false,
      imported: false,
    };
  });

  return {
    suggestions,
    meta: {
      fromMs,
      toMs,
      deviceCount: devices.length,
      devicesWithStops: feed.devicesWithStops,
      tripsScanned: feed.tripsScanned,
      stops: feed.stops.length,
      excludedInZone,
      excludedShort: feed.excludedShort,
      clusters: clusters.length,
      qualifying: filtered.length,
    },
  };
}
