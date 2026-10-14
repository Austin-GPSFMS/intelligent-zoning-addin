/** Formatting + parsing helpers. */

/** Parse a .NET TimeSpan string ("1.02:03:04" | "02:03:04" | "02:03:04.5") to ms. */
export function parseTimeSpanMs(ts: string | number | undefined | null): number {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts * 1000;
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(ts));
  if (!m) return 0;
  const days = parseInt(m[1] ?? "0", 10);
  const h = parseInt(m[2], 10);
  const mi = parseInt(m[3], 10);
  const s = parseInt(m[4], 10);
  const frac = m[5] ? parseFloat("0." + m[5]) : 0;
  return (((days * 24 + h) * 60 + mi) * 60 + s + frac) * 1000;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return "—";
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m < 10 ? "0" : ""}${m}m`;
}

export function formatDate(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString();
}

export function formatInt(n: number): string {
  return n.toLocaleString();
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
