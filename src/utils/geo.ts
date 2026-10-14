/** Geometry helpers: distance, point-in-polygon, circle polygons. */

import type { GeotabCoordinate, GeotabZone, PreparedZone } from "../types";

export const toRad = (d: number): number => (d * Math.PI) / 180;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Precompute ring + bbox for every zone with a usable polygon. */
export function prepareZones(zones: GeotabZone[]): PreparedZone[] {
  const out: PreparedZone[] = [];
  for (const z of zones) {
    if (!z.points || z.points.length < 3) continue;
    let minLat = 90,
      maxLat = -90,
      minLng = 180,
      maxLng = -180;
    const ring: Array<[number, number]> = z.points.map((p) => {
      if (p.y < minLat) minLat = p.y;
      if (p.y > maxLat) maxLat = p.y;
      if (p.x < minLng) minLng = p.x;
      if (p.x > maxLng) maxLng = p.x;
      return [p.x, p.y];
    });
    out.push({ id: z.id ?? "", name: z.name, ring, minLat, maxLat, minLng, maxLng });
  }
  return out;
}

/** Ray-casting point-in-polygon. ring = [[lng,lat],...] */
export function pointInRing(lng: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findContainingZone(
  zones: PreparedZone[],
  lat: number,
  lng: number
): PreparedZone | null {
  for (const z of zones) {
    if (lat < z.minLat || lat > z.maxLat || lng < z.minLng || lng > z.maxLng) continue;
    if (pointInRing(lng, lat, z.ring)) return z;
  }
  return null;
}

/** Circle polygon as MyGeotab points [{x: lng, y: lat}], clockwise. */
export function circlePoints(
  lat: number,
  lng: number,
  radiusM: number,
  n = 24
): GeotabCoordinate[] {
  const pts: GeotabCoordinate[] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(toRad(lat)));
  for (let i = 0; i < n; i++) {
    const ang = (-2 * Math.PI * i) / n;
    pts.push({
      x: +(lng + dLng * Math.cos(ang)).toFixed(6),
      y: +(lat + dLat * Math.sin(ang)).toFixed(6),
    });
  }
  return pts;
}
