/**
 * Domain types for Intelligent Zoning.
 *
 * The MyGeotab Add-In API is loosely typed; we narrow at the boundary in
 * api/geotab.ts. Shapes mirror engine_hours_zone/src/types.ts.
 */

export interface GeotabApi {
  call: (
    method: string,
    params: unknown,
    success: (result: unknown) => void,
    failure: (err: unknown) => void
  ) => void;
  multiCall?: (
    calls: Array<[string, unknown]>,
    success: (result: unknown[]) => void,
    failure: (err: unknown) => void
  ) => void;
  getSession?: (
    callback: (
      credentials: { database: string; userName: string; sessionId: string },
      server: string
    ) => void
  ) => void;
}

export interface GeotabSessionInfo {
  database: string;
  server: string;
}

export interface GeotabPageState {
  getGroupFilter?: (cb: (groups: unknown) => void) => void;
  setGroupFilter?: (groups: unknown) => void;
  getState?: (cb: (state: unknown) => void) => void;
  setState?: (state: unknown) => void;
  translate?: (key: string) => string;
}

export interface GeotabDevice {
  id: string;
  name?: string;
  activeFrom?: string;
  activeTo?: string;
  groups?: Array<{ id: string }>;
}

export interface GeotabGroup {
  id: string;
  name?: string;
  children?: Array<{ id: string }>;
}

/** A Geotab Coordinate object — note `x` is longitude, `y` is latitude. */
export interface GeotabCoordinate {
  x: number;
  y: number;
}

/** Subset of Trip fields we use (requested via propertySelector). */
export interface GeotabTrip {
  id?: string;
  device?: { id: string };
  driver?: { id: string };
  stop?: string;
  nextTripStart?: string;
  stopPoint?: GeotabCoordinate;
  /** .NET TimeSpan string, e.g. "1.02:03:04" or "00:12:30". */
  stopDuration?: string;
}

export interface GeotabFeedResult<T> {
  data: T[];
  toVersion: string;
}

export interface GeotabZone {
  id?: string;
  name: string;
  points: GeotabCoordinate[];
  zoneTypes?: Array<{ id: string }>;
  groups?: Array<{ id: string }>;
  activeFrom?: string;
  activeTo?: string;
  displayed?: boolean;
  mustIdentifyStops?: boolean;
  fillColor?: { r: number; g: number; b: number; a: number };
  comment?: string;
  externalReference?: string;
}

export interface GeotabZoneType {
  id: string;
  name?: string;
}

export interface GeotabAddress {
  formattedAddress?: string;
  street?: string;
  city?: string;
  region?: string;
}

/** Zone with precomputed ring + bbox for fast point-in-polygon. */
export interface PreparedZone {
  id: string;
  name: string;
  ring: Array<[number, number]>; // [lng, lat]
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** One trip stop reduced to what clustering needs. */
export interface Stop {
  lat: number;
  lng: number;
  deviceId: string;
  driverId: string | null;
  stopMs: number;
  dwellMs: number;
}

export type ClusterKind =
  | "Yard / depot"
  | "Overnight parking"
  | "Fuel / quick stop"
  | "Customer / job site"
  | "Frequent stop";

export interface Cluster {
  id: string;
  key: string;
  lat: number;
  lng: number;
  stops: Stop[];
  stopCount: number;
  vehicleCount: number;
  driverCount: number;
  dayCount: number;
  totalDwellMs: number;
  avgDwellMs: number;
  firstVisitMs: number;
  lastVisitMs: number;
  spreadP90: number;
  topDevices: Array<{ id: string; count: number }>;
}

export interface Suggestion extends Cluster {
  rank: number;
  score: number;
  kind: ClusterKind;
  name: string;
  address: string;
  radius: number;
  selected: boolean;
  imported: boolean;
  zoneId?: string;
}

export interface ScanSettings {
  lookbackDays: number;
  clusterRadius: number;
  minStops: number;
  minVehicles: number;
  minDwellMinutes: number;
  zoneTypeId: string;
}

export interface ScanMeta {
  fromMs: number;
  toMs: number;
  deviceCount: number;
  devicesWithStops: number;
  tripsScanned: number;
  stops: number;
  excludedInZone: number;
  excludedShort: number;
  clusters: number;
  qualifying: number;
}

export interface ScanProgress {
  phase: "trips" | "cluster" | "geocode" | "import";
  text: string;
  /** 0–100, or null for indeterminate. */
  pct: number | null;
}
