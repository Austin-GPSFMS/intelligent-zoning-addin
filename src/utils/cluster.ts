/**
 * Stop clustering + per-cluster summary.
 *
 * Greedy centroid clustering with a lat/lng grid index so it stays fast on
 * hundreds of thousands of stops (~300k stops in <2 s), followed by a merge
 * pass that lets larger clusters absorb smaller neighbours within the radius.
 */

import type { Cluster, ClusterKind, Stop } from "../types";
import { haversineMeters, toRad } from "./geo";
import { dayKey } from "./format";

interface WorkingCluster {
  lat: number;
  lng: number;
  stops: Stop[];
  cell: string;
}

export function clusterStops(stops: Stop[], radiusM: number): WorkingCluster[] {
  const dLat = radiusM / 111320;
  let grid = new Map<string, WorkingCluster[]>();

  const cellOf = (lat: number, lng: number): string => {
    const dLng = radiusM / (111320 * Math.max(0.05, Math.cos(toRad(lat))));
    return `${Math.floor(lat / dLat)}:${Math.floor(lng / dLng)}`;
  };
  const addToGrid = (c: WorkingCluster) => {
    c.cell = cellOf(c.lat, c.lng);
    const arr = grid.get(c.cell);
    if (arr) arr.push(c);
    else grid.set(c.cell, [c]);
  };
  const removeFromGrid = (c: WorkingCluster) => {
    const arr = grid.get(c.cell);
    if (!arr) return;
    const idx = arr.indexOf(c);
    if (idx >= 0) arr.splice(idx, 1);
  };
  const neighbours = (lat: number, lng: number): WorkingCluster[] => {
    const dLng = radiusM / (111320 * Math.max(0.05, Math.cos(toRad(lat))));
    const ci = Math.floor(lat / dLat);
    const cj = Math.floor(lng / dLng);
    const out: WorkingCluster[] = [];
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const arr = grid.get(`${ci + a}:${cj + b}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  };

  const clusters: WorkingCluster[] = [];
  for (const st of stops) {
    let best: WorkingCluster | null = null;
    let bestD = Infinity;
    for (const c of neighbours(st.lat, st.lng)) {
      const d = haversineMeters(st.lat, st.lng, c.lat, c.lng);
      if (d <= radiusM && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) {
      const n = best.stops.length;
      best.lat = (best.lat * n + st.lat) / (n + 1);
      best.lng = (best.lng * n + st.lng) / (n + 1);
      best.stops.push(st);
      const newCell = cellOf(best.lat, best.lng);
      if (newCell !== best.cell) {
        removeFromGrid(best);
        addToGrid(best);
      }
    } else {
      const nc: WorkingCluster = { lat: st.lat, lng: st.lng, stops: [st], cell: "" };
      clusters.push(nc);
      addToGrid(nc);
    }
  }

  // Merge pass: bigger clusters absorb smaller ones within the radius.
  clusters.sort((a, b) => b.stops.length - a.stops.length);
  grid = new Map();
  const alive: WorkingCluster[] = [];
  for (const cl of clusters) {
    let target: WorkingCluster | null = null;
    let tD = Infinity;
    for (const near of neighbours(cl.lat, cl.lng)) {
      const d = haversineMeters(cl.lat, cl.lng, near.lat, near.lng);
      if (d <= radiusM && d < tD) {
        target = near;
        tD = d;
      }
    }
    if (target) {
      const n1 = target.stops.length;
      const n2 = cl.stops.length;
      target.lat = (target.lat * n1 + cl.lat * n2) / (n1 + n2);
      target.lng = (target.lng * n1 + cl.lng * n2) / (n1 + n2);
      target.stops.push(...cl.stops);
    } else {
      alive.push(cl);
      addToGrid(cl);
    }
  }
  return alive;
}

/** ~11 m resolution; used as the stable identity for the "dismissed" memory. */
export function clusterKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function summarize(c: WorkingCluster): Cluster {
  const devs = new Map<string, number>();
  const drivers = new Set<string>();
  const days = new Set<string>();
  let totalDwell = 0;
  let first = Infinity;
  let last = -Infinity;
  const dists: number[] = [];
  for (const s of c.stops) {
    devs.set(s.deviceId, (devs.get(s.deviceId) ?? 0) + 1);
    if (s.driverId) drivers.add(s.driverId);
    days.add(dayKey(s.stopMs));
    totalDwell += s.dwellMs;
    if (s.stopMs < first) first = s.stopMs;
    if (s.stopMs > last) last = s.stopMs;
    dists.push(haversineMeters(c.lat, c.lng, s.lat, s.lng));
  }
  dists.sort((a, b) => a - b);
  const p90 = dists.length
    ? dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))]
    : 0;
  const key = clusterKey(c.lat, c.lng);
  return {
    id: "iz-" + key.replace(/[^0-9a-z]/gi, ""),
    key,
    lat: c.lat,
    lng: c.lng,
    stops: c.stops,
    stopCount: c.stops.length,
    vehicleCount: devs.size,
    driverCount: drivers.size,
    dayCount: days.size,
    totalDwellMs: totalDwell,
    avgDwellMs: c.stops.length ? totalDwell / c.stops.length : 0,
    firstVisitMs: first,
    lastVisitMs: last,
    spreadP90: p90,
    topDevices: [...devs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count })),
  };
}

/** Suggested zone radius from the p90 stop spread, clamped to [60 m, cluster radius]. */
export function suggestedRadius(c: Cluster, clusterRadiusM: number): number {
  const r = Math.round((c.spreadP90 * 1.25 + 25) / 10) * 10;
  return Math.max(60, Math.min(clusterRadiusM, r));
}

/**
 * Activity score 0–100, relative to the strongest cluster in the set.
 * Weighted blend of (log) stop frequency, fleet breadth, (log) dwell, and
 * distinct visit days — "magnitude of activity".
 */
export function scoreClusters(list: Cluster[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (!list.length) return scores;
  let maxStops = 0,
    maxVeh = 0,
    maxDwell = 0,
    maxDays = 0;
  for (const c of list) {
    maxStops = Math.max(maxStops, Math.log1p(c.stopCount));
    maxVeh = Math.max(maxVeh, c.vehicleCount);
    maxDwell = Math.max(maxDwell, Math.log1p(c.totalDwellMs / 3600000));
    maxDays = Math.max(maxDays, c.dayCount);
  }
  for (const c of list) {
    const fStops = maxStops ? Math.log1p(c.stopCount) / maxStops : 0;
    const fVeh = maxVeh ? c.vehicleCount / maxVeh : 0;
    const fDwell = maxDwell ? Math.log1p(c.totalDwellMs / 3600000) / maxDwell : 0;
    const fDays = maxDays ? c.dayCount / maxDays : 0;
    scores.set(
      c.id,
      Math.round(100 * (0.4 * fStops + 0.25 * fVeh + 0.2 * fDwell + 0.15 * fDays))
    );
  }
  return scores;
}

/** Light-touch hint at what kind of place this probably is. */
export function classify(c: Cluster, fleetSize: number): ClusterKind {
  const avgH = c.avgDwellMs / 3600000;
  const fleetShare = fleetSize ? c.vehicleCount / fleetSize : 0;
  if (avgH >= 8 && fleetShare >= 0.2) return "Yard / depot";
  if (avgH >= 8) return "Overnight parking";
  if (c.vehicleCount >= 3 && avgH < 0.5) return "Fuel / quick stop";
  if (c.dayCount >= 5 && avgH >= 0.5) return "Customer / job site";
  return "Frequent stop";
}
