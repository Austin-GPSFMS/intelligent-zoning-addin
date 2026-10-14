/** CSV export of the current suggestion list. */

import type { Suggestion } from "../types";

export function exportSuggestionsCsv(list: Suggestion[]): void {
  const rows: Array<Array<string | number>> = [
    [
      "Rank", "Score", "Name", "Address", "Type hint", "Latitude", "Longitude", "Radius (m)",
      "Stops", "Vehicles", "Drivers", "Days", "Avg dwell (h)", "Total dwell (h)",
      "First visit", "Last visit", "Imported",
    ],
  ];
  for (const c of list) {
    rows.push([
      c.rank, c.score, c.name, c.address, c.kind, c.lat.toFixed(6), c.lng.toFixed(6), c.radius,
      c.stopCount, c.vehicleCount, c.driverCount, c.dayCount,
      (c.avgDwellMs / 3600000).toFixed(2), (c.totalDwellMs / 3600000).toFixed(2),
      new Date(c.firstVisitMs).toISOString(), new Date(c.lastVisitMs).toISOString(),
      c.imported ? "yes" : "no",
    ]);
  }
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `intelligent-zoning-suggestions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
