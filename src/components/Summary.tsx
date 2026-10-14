/** KPI strip for the last scan, using Zenith SummaryTiles. */

import { SummaryTile, SummaryTileBar, SummaryTileType } from "@geotab/zenith";
import type { ScanMeta } from "../types";
import { formatDate, formatInt } from "../utils/format";

interface SummaryProps {
  meta: ScanMeta;
  existingZones: number;
  clusterRadius: number;
}

export function Summary({ meta, existingZones, clusterRadius }: SummaryProps) {
  return (
    <div className="iz-summary">
      <SummaryTileBar aria-label="Scan summary">
        <SummaryTile title="Vehicles with stops">
          <span className="iz-tile-value">
            {formatInt(meta.devicesWithStops)}
            <small> / {formatInt(meta.deviceCount)}</small>
          </span>
        </SummaryTile>
        <SummaryTile title="Trips scanned">
          <span className="iz-tile-value">{formatInt(meta.tripsScanned)}</span>
        </SummaryTile>
        <SummaryTile title="Stops outside zones">
          <span className="iz-tile-value">{formatInt(meta.stops)}</span>
        </SummaryTile>
        <SummaryTile
          title="Stops already in a zone"
          tooltipText={`Stops that fell inside one of the ${formatInt(existingZones)} existing zones and were ignored.`}
        >
          <span className="iz-tile-value">{formatInt(meta.excludedInZone)}</span>
        </SummaryTile>
        <SummaryTile title="Clusters found">
          <span className="iz-tile-value">{formatInt(meta.clusters)}</span>
        </SummaryTile>
        <SummaryTile
          title="Qualifying suggestions"
          tileType={meta.qualifying > 0 ? SummaryTileType.Active : SummaryTileType.Default}
        >
          <span className="iz-tile-value">{formatInt(meta.qualifying)}</span>
        </SummaryTile>
      </SummaryTileBar>
      <div className="iz-period">
        {formatDate(meta.fromMs)} – {formatDate(meta.toMs)} · {clusterRadius} m cluster radius ·{" "}
        {formatInt(meta.excludedShort)} stops under the dwell minimum skipped
      </div>
    </div>
  );
}
