/** localStorage persistence for scan settings and dismissed suggestions. */

import type { ScanSettings } from "../types";

const SETTINGS_KEY = "gpsfms.intelligentZoning.settings";
const DISMISS_KEY = "gpsfms.intelligentZoning.dismissed";

export const DEFAULT_SETTINGS: ScanSettings = {
  lookbackDays: 30,
  clusterRadius: 150,
  minStops: 5,
  minVehicles: 1,
  minDwellMinutes: 3,
  zoneTypeId: "ZoneTypeCustomerId",
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadSettings(): ScanSettings {
  return load<ScanSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveSettings(s: ScanSettings): void {
  save(SETTINGS_KEY, s);
}

export function loadDismissed(): Record<string, true> {
  return load<Record<string, true>>(DISMISS_KEY, {});
}

export function saveDismissed(d: Record<string, true>): void {
  save(DISMISS_KEY, d);
}
