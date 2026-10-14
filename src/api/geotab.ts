/**
 * Promise-based wrappers around the MyGeotab Add-In `api.call` interface.
 *
 * Mirrors engine_hours_zone/src/api/geotab.ts: every call goes through
 * `apiCall<T>` so there is one place to pace requests and surface typed
 * errors.
 *
 * Quota notes (the reason v1 failed with "API calls quota exceeded"):
 *   MyGeotab allows ~1000 API calls per user per minute and every child of
 *   a multiCall counts individually. Querying trips per device therefore
 *   costs one call per vehicle. Instead we pull trips fleet-wide with
 *   GetFeed (50,000 trips per call) and filter to the selected devices
 *   client-side — a 30-day scan of a 500-vehicle database is ~4–6 calls.
 */

import type {
  GeotabAddress,
  GeotabApi,
  GeotabDevice,
  GeotabFeedResult,
  GeotabGroup,
  GeotabSessionInfo,
  GeotabTrip,
  GeotabZone,
  GeotabZoneType,
  Stop,
} from "../types";
import { parseTimeSpanMs } from "../utils/format";

/** Small spacing between back-to-back calls (rate-limit politeness). */
const INTER_CALL_DELAY_MS = 60;
/** GetFeed hard cap per call. */
const FEED_LIMIT = 50000;
/** Safety valve on feed paging (50k × 400 = 20M trips). */
const FEED_MAX_PAGES = 400;
const GEOCODE_BATCH = 50;

const TRIP_FIELDS = [
  "id",
  "device",
  "driver",
  "stop",
  "nextTripStart",
  "stopPoint",
  "stopDuration",
];

export function apiCall<T = unknown>(
  api: GeotabApi,
  method: string,
  params: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      api.call(
        method,
        params,
        (result) => {
          setTimeout(() => resolve(result as T), INTER_CALL_DELAY_MS);
        },
        (err) => reject(err)
      );
    } catch (err) {
      reject(err);
    }
  });
}

export function apiMultiCall<T = unknown>(
  api: GeotabApi,
  calls: Array<[string, unknown]>
): Promise<T[]> {
  if (typeof api.multiCall !== "function") {
    // Fallback: sequential single calls.
    return calls.reduce<Promise<T[]>>(
      (p, c) =>
        p.then((acc) => apiCall<T>(api, c[0], c[1]).then((r) => [...acc, r])),
      Promise.resolve([])
    );
  }
  return new Promise((resolve, reject) => {
    try {
      api.multiCall!(
        calls,
        (result) => setTimeout(() => resolve(result as T[]), INTER_CALL_DELAY_MS),
        (err) => reject(err)
      );
    } catch (err) {
      reject(err);
    }
  });
}

export function friendlyError(err: unknown): string {
  if (err == null) return "Unknown error.";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as { name?: string; message?: string };
    if (e.name === "InvalidUserException" || /InvalidUser/i.test(String(err))) {
      return "Session expired — refresh the MyGeotab page to re-authenticate.";
    }
    if (/quota/i.test(e.message ?? "")) {
      return `${e.message} — wait a minute and try again with a shorter look-back.`;
    }
    if (e.message) return e.message;
  }
  return String(err);
}

export function fetchSession(api: GeotabApi): Promise<GeotabSessionInfo> {
  return new Promise((resolve) => {
    if (typeof api.getSession !== "function") {
      resolve({ database: "", server: "" });
      return;
    }
    let settled = false;
    const safeResolve = (s: GeotabSessionInfo) => {
      if (settled) return;
      settled = true;
      resolve(s);
    };
    setTimeout(() => safeResolve({ database: "", server: "" }), 3000);
    try {
      api.getSession((credentials, server) => {
        safeResolve({
          database: credentials?.database ?? "",
          server: server || "my.geotab.com",
        });
      });
    } catch {
      safeResolve({ database: "", server: "" });
    }
  });
}

export async function fetchGroups(
  api: GeotabApi
): Promise<Map<string, GeotabGroup>> {
  const groups = await apiCall<GeotabGroup[]>(api, "Get", {
    typeName: "Group",
    resultsLimit: 5000,
  });
  return new Map(groups.map((g) => [g.id, g]));
}

/** Devices scoped to a set of groups (server resolves descendants). */
export async function fetchDevices(
  api: GeotabApi,
  groupIds: string[] = []
): Promise<GeotabDevice[]> {
  const search =
    groupIds.length > 0
      ? { groups: groupIds.map((id) => ({ id })) }
      : { groups: [{ id: "GroupCompanyId" }] };
  const devices = await apiCall<GeotabDevice[]>(api, "Get", {
    typeName: "Device",
    search,
    resultsLimit: 50000,
  });
  return devices
    .filter((d) => {
      if (d.id === "NoDeviceId") return false;
      if (!d.activeTo) return true;
      const t = new Date(d.activeTo).getTime();
      return isNaN(t) ? true : t > Date.now();
    })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export async function fetchZones(api: GeotabApi): Promise<GeotabZone[]> {
  return apiCall<GeotabZone[]>(api, "Get", {
    typeName: "Zone",
    resultsLimit: 50000,
  });
}

export async function fetchZoneTypes(api: GeotabApi): Promise<GeotabZoneType[]> {
  return apiCall<GeotabZoneType[]>(api, "Get", { typeName: "ZoneType" });
}

export interface StopFeedResult {
  stops: Stop[];
  tripsScanned: number;
  excludedShort: number;
  devicesWithStops: number;
}

/**
 * Stream every Trip in the database since `fromMs` via GetFeed and reduce
 * each one to a Stop for devices in `deviceIds`.
 *
 * GetFeed returns trips in version (modification) order starting at the
 * version nearest `search.fromDate`, 50,000 per call, until `data.length`
 * drops below the limit (caught up to now). We additionally filter on
 * `stop >= fromMs` because a feed window can include older trips that were
 * edited recently.
 *
 * `keep(lat, lng)` lets the caller veto stops (existing-zone exclusion) so
 * the trip array is never retained in memory.
 */
export async function fetchStopsViaFeed(
  api: GeotabApi,
  deviceIds: Set<string>,
  fromMs: number,
  minDwellMs: number,
  keep: (lat: number, lng: number) => boolean,
  onProgress: (tripsScanned: number, stopsKept: number, page: number) => void,
  isCancelled: () => boolean
): Promise<StopFeedResult> {
  const stops: Stop[] = [];
  const devicesSeen = new Set<string>();
  let tripsScanned = 0;
  let excludedShort = 0;
  let fromVersion: string | null = null;
  let useSelector = true;

  for (let page = 1; page <= FEED_MAX_PAGES; page++) {
    if (isCancelled()) throw new Error("Cancelled.");

    const params: Record<string, unknown> = {
      typeName: "Trip",
      resultsLimit: FEED_LIMIT,
    };
    if (fromVersion) params.fromVersion = fromVersion;
    else params.search = { fromDate: new Date(fromMs).toISOString() };
    if (useSelector) {
      params.propertySelector = { fields: TRIP_FIELDS, isIncluded: true };
    }

    let result: GeotabFeedResult<GeotabTrip>;
    try {
      result = await apiCall<GeotabFeedResult<GeotabTrip>>(api, "GetFeed", params);
    } catch (err) {
      if (useSelector) {
        // Older servers may reject propertySelector on GetFeed — retry without.
        useSelector = false;
        delete params.propertySelector;
        result = await apiCall<GeotabFeedResult<GeotabTrip>>(api, "GetFeed", params);
      } else {
        throw err;
      }
    }

    const data = result?.data ?? [];
    for (const t of data) {
      tripsScanned++;
      const devId = t.device?.id;
      if (!devId || !deviceIds.has(devId)) continue;
      const sp = t.stopPoint;
      if (!sp || (sp.x === 0 && sp.y === 0)) continue;
      const lat = sp.y;
      const lng = sp.x;
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const stopMs = t.stop ? new Date(t.stop).getTime() : NaN;
      if (!isFinite(stopMs) || stopMs < fromMs) continue;

      let dwellMs = 0;
      if (t.nextTripStart) {
        dwellMs = new Date(t.nextTripStart).getTime() - stopMs;
      }
      if (!(dwellMs > 0)) dwellMs = parseTimeSpanMs(t.stopDuration);
      if (dwellMs < minDwellMs) {
        excludedShort++;
        continue;
      }
      if (!keep(lat, lng)) continue;

      devicesSeen.add(devId);
      stops.push({
        lat,
        lng,
        deviceId: devId,
        driverId:
          t.driver?.id && t.driver.id !== "UnknownDriverId" ? t.driver.id : null,
        stopMs,
        dwellMs,
      });
    }

    onProgress(tripsScanned, stops.length, page);
    const nextVersion = result?.toVersion ?? null;
    // Stop on an empty page (or a stalled version) rather than on
    // `data.length < limit`: the server can hand back a short page before
    // the feed is actually caught up, and one extra call is cheap.
    if (data.length === 0 || !nextVersion || nextVersion === fromVersion) break;
    fromVersion = nextVersion;
  }

  return {
    stops,
    tripsScanned,
    excludedShort,
    devicesWithStops: devicesSeen.size,
  };
}

/** Reverse-geocode a list of coordinates in batches of 50. */
export async function fetchAddresses(
  api: GeotabApi,
  coords: Array<{ lat: number; lng: number }>
): Promise<GeotabAddress[]> {
  const out: GeotabAddress[] = [];
  for (let i = 0; i < coords.length; i += GEOCODE_BATCH) {
    const chunk = coords.slice(i, i + GEOCODE_BATCH);
    try {
      const res = await apiCall<GeotabAddress[]>(api, "GetAddresses", {
        coordinates: chunk.map((c) => ({ x: c.lng, y: c.lat })),
        movingAddresses: false,
      });
      for (let j = 0; j < chunk.length; j++) out.push(res?.[j] ?? {});
    } catch {
      for (let j = 0; j < chunk.length; j++) out.push({});
    }
  }
  return out;
}

/** Create zones in one multiCall; returns the new ids in order. */
export async function addZones(
  api: GeotabApi,
  zones: GeotabZone[]
): Promise<string[]> {
  const calls: Array<[string, unknown]> = zones.map((z) => [
    "Add",
    { typeName: "Zone", entity: z },
  ]);
  const ids = await apiMultiCall<string>(api, calls);
  return ids.map((id) => String(id));
}
