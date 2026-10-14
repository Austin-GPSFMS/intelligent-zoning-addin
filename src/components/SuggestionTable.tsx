/**
 * Review table for the suggested zones. Name and radius are editable before
 * import; rows can be imported one at a time or dismissed (remembered).
 */

import { Button, Checkbox, TextInputRaw } from "@geotab/zenith";
import type { GeotabDevice, Suggestion } from "../types";
import { formatDate, formatDuration, formatInt } from "../utils/format";

interface SuggestionTableProps {
  suggestions: Suggestion[];
  devicesById: Map<string, GeotabDevice>;
  activeId: string | null;
  busy: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onRename: (id: string, name: string) => void;
  onRadius: (id: string, radius: number) => void;
  onImportOne: (id: string) => void;
  onDismiss: (id: string) => void;
  onFocus: (id: string) => void;
}

export function SuggestionTable({
  suggestions,
  devicesById,
  activeId,
  busy,
  onToggle,
  onToggleAll,
  onRename,
  onRadius,
  onImportOne,
  onDismiss,
  onFocus,
}: SuggestionTableProps) {
  const selectable = suggestions.filter((s) => !s.imported);
  const allChecked = selectable.length > 0 && selectable.every((s) => s.selected);
  const someChecked = selectable.some((s) => s.selected);

  return (
    <div className="iz-table-wrap">
      <table className="iz-table">
        <thead>
          <tr>
            <th className="iz-c">
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked && !allChecked}
                disabled={busy || selectable.length === 0}
                ariaLabel="Select all"
                onChange={(e) => onToggleAll(e.target.checked)}
              />
            </th>
            <th className="iz-c">#</th>
            <th>Score</th>
            <th>Suggested zone</th>
            <th>Looks like</th>
            <th className="iz-num">Stops</th>
            <th className="iz-num">Vehicles</th>
            <th className="iz-num">Days</th>
            <th className="iz-num">Avg dwell</th>
            <th className="iz-num">Total dwell</th>
            <th className="iz-num">Last visit</th>
            <th className="iz-num">Radius (m)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((c) => {
            const vehTitle = c.topDevices
              .map((d) => `${devicesById.get(d.id)?.name ?? d.id} (${d.count})`)
              .join(", ");
            const mapsHref = `https://www.google.com/maps?q=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
            const cls =
              "iz-row" +
              (c.imported ? " iz-imported" : "") +
              (activeId === c.id ? " iz-active" : "");
            return (
              <tr
                key={c.id}
                className={cls}
                onClick={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.closest("input,button,a,label")) return;
                  onFocus(c.id);
                }}
              >
                <td className="iz-c">
                  <Checkbox
                    checked={c.selected}
                    disabled={busy || c.imported}
                    ariaLabel={`Select ${c.name}`}
                    onChange={(e) => onToggle(c.id, e.target.checked)}
                  />
                </td>
                <td className="iz-c iz-rank">{c.rank}</td>
                <td className="iz-score">
                  <div className="iz-scorebar">
                    <span style={{ width: `${c.score}%` }} />
                  </div>
                  <b>{c.score}</b>
                </td>
                <td className="iz-namecell">
                  <TextInputRaw
                    value={c.name}
                    disabled={busy || c.imported}
                    ariaLabel="Zone name"
                    onChange={(e) => onRename(c.id, e.target.value)}
                  />
                  <div className="iz-addr" title={c.address}>
                    {c.address || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`}
                  </div>
                </td>
                <td>
                  <span className="iz-pill">{c.kind}</span>
                </td>
                <td className="iz-num">{formatInt(c.stopCount)}</td>
                <td className="iz-num" title={vehTitle}>
                  {c.vehicleCount}
                </td>
                <td className="iz-num">{c.dayCount}</td>
                <td className="iz-num">{formatDuration(c.avgDwellMs)}</td>
                <td className="iz-num">{formatDuration(c.totalDwellMs)}</td>
                <td className="iz-num">{formatDate(c.lastVisitMs)}</td>
                <td className="iz-num iz-radiuscell">
                  <TextInputRaw
                    type="number"
                    value={String(c.radius)}
                    min={30}
                    max={2000}
                    step={10}
                    disabled={busy || c.imported}
                    ariaLabel="Zone radius in metres"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (isFinite(v)) onRadius(c.id, v);
                    }}
                  />
                </td>
                <td className="iz-actions">
                  {c.imported ? (
                    <span className="iz-badge-ok">Imported</span>
                  ) : (
                    <>
                      <Button
                        type="secondary"
                        disabled={busy}
                        onClick={() => onImportOne(c.id)}
                      >
                        Import
                      </Button>
                      <Button
                        type="tertiary"
                        disabled={busy}
                        title="Hide this suggestion in future scans"
                        onClick={() => onDismiss(c.id)}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                  <a className="iz-maplink" href={mapsHref} target="_blank" rel="noopener noreferrer">
                    Map ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
