/**
 * Intelligent Zoning — main app.
 *
 *   Toolbar: Group filter · Look-back · Cluster radius · Min stops/vehicles/dwell · Zone type
 *            Buttons: Scan fleet · Export CSV
 *   Banners: standalone, errors, progress, success
 *   Results: Summary tiles · Map · Import toolbar · Suggestion table
 *
 * Same Zenith vocabulary as Engine Hours by Zone / Advanced Report Builder so
 * the page reads native inside MyGeotab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  Dropdown,
  ProgressBar,
  type ISelectionItem,
} from "@geotab/zenith";
import type {
  GeotabApi,
  GeotabDevice,
  GeotabGroup,
  GeotabPageState,
  GeotabZone,
  GeotabZoneType,
  PreparedZone,
  ScanMeta,
  ScanProgress,
  ScanSettings,
  Suggestion,
} from "./types";
import {
  addZones,
  fetchDevices,
  fetchGroups,
  fetchZoneTypes,
  fetchZones,
  friendlyError,
} from "./api/geotab";
import { circlePoints, prepareZones } from "./utils/geo";
import { runScan } from "./utils/scan";
import { exportSuggestionsCsv } from "./utils/export";
import {
  loadDismissed,
  loadSettings,
  saveDismissed,
  saveSettings,
} from "./utils/storage";
import { formatDuration } from "./utils/format";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { Summary } from "./components/Summary";
import { SuggestionMap } from "./components/SuggestionMap";
import { SuggestionTable } from "./components/SuggestionTable";

interface AppProps {
  api: GeotabApi | null;
  pageState: GeotabPageState | null;
}

const lookbackItems: ISelectionItem[] = [
  { id: "7", name: "Look back: 7 days" },
  { id: "14", name: "Look back: 14 days" },
  { id: "30", name: "Look back: 30 days" },
  { id: "60", name: "Look back: 60 days" },
  { id: "90", name: "Look back: 90 days" },
];

const radiusItems: ISelectionItem[] = [
  { id: "75", name: "Cluster radius: 75 m" },
  { id: "100", name: "Cluster radius: 100 m" },
  { id: "150", name: "Cluster radius: 150 m" },
  { id: "250", name: "Cluster radius: 250 m" },
  { id: "500", name: "Cluster radius: 500 m" },
  { id: "1000", name: "Cluster radius: 1 km" },
];

const minStopsItems: ISelectionItem[] = [1, 2, 3, 5, 10, 20, 50].map((n) => ({
  id: String(n),
  name: `Min stops: ${n}`,
}));

const minVehiclesItems: ISelectionItem[] = [1, 2, 3, 5, 10].map((n) => ({
  id: String(n),
  name: `Min vehicles: ${n}`,
}));

const minDwellItems: ISelectionItem[] = [0, 2, 3, 5, 10, 15, 30, 60].map((n) => ({
  id: String(n),
  name: n === 0 ? "Min dwell: any" : `Min dwell: ${n} min`,
}));

function buildZoneEntity(c: Suggestion, zoneTypeId: string, groupIds: string[]): GeotabZone {
  return {
    name: c.name.trim(),
    points: circlePoints(c.lat, c.lng, c.radius, 24),
    zoneTypes: [{ id: zoneTypeId }],
    groups: groupIds.map((id) => ({ id })),
    activeFrom: new Date().toISOString(),
    activeTo: "2050-01-01T00:00:00.000Z",
    displayed: true,
    mustIdentifyStops: true,
    fillColor: { r: 0, g: 132, b: 194, a: 96 },
    comment:
      `Suggested by Intelligent Zoning add-in on ${new Date().toISOString().slice(0, 10)}: ` +
      `${c.stopCount} stops, ${c.vehicleCount} vehicles, ${formatDuration(c.totalDwellMs)} dwell over ${c.dayCount} days.` +
      (c.address ? ` ${c.address}` : ""),
  };
}

export default function App({ api, pageState: _pageState }: AppProps) {
  const insideMyGeotab = api != null;

  // ---- Groups & devices ----
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(() => new Map());
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsErr, setGroupsErr] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(["GroupCompanyId"]);
  const [devices, setDevices] = useState<GeotabDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesErr, setDevicesErr] = useState<string | null>(null);

  // ---- Zones ----
  const [existingZones, setExistingZones] = useState<PreparedZone[]>([]);
  const [zoneTypes, setZoneTypes] = useState<GeotabZoneType[]>([]);
  const [zonesErr, setZonesErr] = useState<string | null>(null);

  // ---- Settings ----
  const [settings, setSettings] = useState<ScanSettings>(() => loadSettings());
  const [dismissed, setDismissed] = useState<Record<string, true>>(() => loadDismissed());
  useEffect(() => saveSettings(settings), [settings]);

  // ---- Scan state ----
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [meta, setMeta] = useState<ScanMeta | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const busy = isScanning || isImporting;

  // ---- Initial load: groups, zones, zone types ----
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    fetchGroups(api)
      .then((m) => {
        if (cancelled) return;
        setGroupsById(m);
        setGroupsLoaded(true);
      })
      .catch((e) => !cancelled && setGroupsErr(friendlyError(e)));
    Promise.all([fetchZones(api), fetchZoneTypes(api)])
      .then(([zones, types]) => {
        if (cancelled) return;
        setExistingZones(prepareZones(zones));
        setZoneTypes(types);
        if (types.length && !types.some((t) => t.id === settings.zoneTypeId)) {
          const customer = types.find((t) => t.id === "ZoneTypeCustomerId");
          setSettings((s) => ({ ...s, zoneTypeId: (customer ?? types[0]).id }));
        }
      })
      .catch((e) => !cancelled && setZonesErr(friendlyError(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // ---- Devices follow the group selection ----
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setDevicesLoading(true);
    setDevicesErr(null);
    fetchDevices(api, selectedGroupIds)
      .then((list) => {
        if (cancelled) return;
        setDevices(list);
      })
      .catch((e) => !cancelled && setDevicesErr(friendlyError(e)))
      .finally(() => !cancelled && setDevicesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, selectedGroupIds]);

  const devicesById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const zoneTypeItems = useMemo<ISelectionItem[]>(() => {
    const list = zoneTypes.length ? zoneTypes : [{ id: "ZoneTypeCustomerId", name: "Customer" }];
    return list
      .slice()
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
      .map((t) => ({ id: t.id, name: `Import as: ${t.name ?? t.id}` }));
  }, [zoneTypes]);

  const onGroupsChange = useCallback((ids: string[]) => {
    setSelectedGroupIds(ids.length > 0 ? ids : ["GroupCompanyId"]);
  }, []);

  const setNumeric =
    (key: keyof ScanSettings) =>
    (items: ISelectionItem[]) => {
      const id = items[0]?.id;
      if (id != null) setSettings((s) => ({ ...s, [key]: parseInt(String(id), 10) }));
    };

  // ---- Scan ----
  const onScan = useCallback(async () => {
    if (!api) return;
    setScanErr(null);
    setNotice(null);
    setSuggestions([]);
    setMeta(null);
    setActiveId(null);
    cancelRef.current = false;
    if (devices.length === 0) {
      setScanErr("No vehicles in the selected group(s).");
      return;
    }
    setIsScanning(true);
    try {
      const res = await runScan(
        api,
        devices,
        existingZones,
        settings,
        dismissed,
        setProgress,
        () => cancelRef.current
      );
      setSuggestions(res.suggestions);
      setMeta(res.meta);
    } catch (e) {
      setScanErr(friendlyError(e));
    } finally {
      setIsScanning(false);
      setProgress(null);
    }
  }, [api, devices, existingZones, settings, dismissed]);

  const onCancel = () => {
    cancelRef.current = true;
  };

  // ---- Table edits ----
  const patch = (id: string, p: Partial<Suggestion>) =>
    setSuggestions((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const onToggleAll = (checked: boolean) =>
    setSuggestions((list) => list.map((s) => (s.imported ? s : { ...s, selected: checked })));

  const onDismiss = (id: string) => {
    const c = suggestions.find((s) => s.id === id);
    if (!c) return;
    const next = { ...dismissed, [c.key]: true as const };
    setDismissed(next);
    saveDismissed(next);
    setSuggestions((list) =>
      list.filter((s) => s.id !== id).map((s, i) => ({ ...s, rank: i + 1 }))
    );
    if (activeId === id) setActiveId(null);
  };

  const onResetDismissed = () => {
    setDismissed({});
    saveDismissed({});
    setNotice("Dismissed suggestions cleared — run the scan again to see them.");
  };

  // ---- Import ----
  const importList = useCallback(
    async (list: Suggestion[]) => {
      if (!api) return;
      const todo = list.filter((c) => !c.imported);
      if (!todo.length) return;
      const unnamed = todo.filter((c) => !c.name.trim());
      if (unnamed.length) {
        setScanErr(
          `Every zone needs a name before import (#${unnamed.map((c) => c.rank).join(", #")}).`
        );
        return;
      }
      setScanErr(null);
      setNotice(null);
      setIsImporting(true);
      setProgress({
        phase: "import",
        text: `Creating ${todo.length} zone${todo.length === 1 ? "" : "s"}…`,
        pct: null,
      });
      try {
        const ids = await addZones(
          api,
          todo.map((c) => buildZoneEntity(c, settings.zoneTypeId, selectedGroupIds))
        );
        const byId = new Map(todo.map((c, i) => [c.id, ids[i]]));
        setSuggestions((cur) =>
          cur.map((s) =>
            byId.has(s.id) ? { ...s, imported: true, selected: false, zoneId: byId.get(s.id) } : s
          )
        );
        // Keep the exclusion list current so a re-scan won't re-suggest them.
        setExistingZones((cur) => [
          ...cur,
          ...prepareZones(
            todo.map((c) => ({
              id: byId.get(c.id),
              name: c.name,
              points: circlePoints(c.lat, c.lng, c.radius, 24),
            }))
          ),
        ]);
        setNotice(
          `${todo.length} zone${todo.length === 1 ? "" : "s"} created — find them under Zones & Messages → Zones.`
        );
      } catch (e) {
        setScanErr(
          `Import failed: ${friendlyError(e)} (if some zones were created before the failure, check the Zones page before retrying).`
        );
      } finally {
        setIsImporting(false);
        setProgress(null);
      }
    },
    [api, settings.zoneTypeId, selectedGroupIds]
  );

  const selectedCount = suggestions.filter((s) => s.selected && !s.imported).length;
  const dismissedCount = Object.keys(dismissed).length;

  // ---- Render ----
  return (
    <div className="iz-page">
      <header className="iz-page-header">
        <div>
          <h2>Intelligent Zoning</h2>
          <p>
            Finds the places your fleet stops most often that aren't covered by a zone yet,
            scores them by activity, and lets you import them as zones in one click.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            type="secondary"
            onClick={() => exportSuggestionsCsv(suggestions)}
            disabled={!suggestions.length || busy}
          >
            Export CSV
          </Button>
          {isScanning ? (
            <Button type="secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button
              type="primary"
              onClick={onScan}
              disabled={!insideMyGeotab || busy || devicesLoading || devices.length === 0}
            >
              Scan fleet
            </Button>
          )}
        </div>
      </header>

      <div className="iz-toolbar">
        {groupsLoaded ? (
          <GroupFilterPicker
            groupsById={groupsById}
            initialGroupIds={selectedGroupIds}
            onChange={onGroupsChange}
            onError={(e) => setGroupsErr(e.message)}
          />
        ) : (
          <div className="iz-muted">{insideMyGeotab ? "Loading groups…" : "Groups"}</div>
        )}
        <Dropdown
          value={[String(settings.lookbackDays)]}
          dataItems={lookbackItems}
          onChange={setNumeric("lookbackDays")}
          errorHandler={(e) => console.error("[IZ] Look back:", e)}
          forceSelection
          multiselect={false}
          showSelection
          showCounterPill={false}
          placeholder="Look back"
        />
        <Dropdown
          value={[String(settings.clusterRadius)]}
          dataItems={radiusItems}
          onChange={setNumeric("clusterRadius")}
          errorHandler={(e) => console.error("[IZ] Radius:", e)}
          forceSelection
          multiselect={false}
          showSelection
          showCounterPill={false}
          placeholder="Cluster radius"
        />
        <Dropdown
          value={[String(settings.minStops)]}
          dataItems={minStopsItems}
          onChange={setNumeric("minStops")}
          errorHandler={(e) => console.error("[IZ] Min stops:", e)}
          forceSelection
          multiselect={false}
          showSelection
          showCounterPill={false}
          placeholder="Min stops"
        />
        <Dropdown
          value={[String(settings.minVehicles)]}
          dataItems={minVehiclesItems}
          onChange={setNumeric("minVehicles")}
          errorHandler={(e) => console.error("[IZ] Min vehicles:", e)}
          forceSelection
          multiselect={false}
          showSelection
          showCounterPill={false}
          placeholder="Min vehicles"
        />
        <Dropdown
          value={[String(settings.minDwellMinutes)]}
          dataItems={minDwellItems}
          onChange={setNumeric("minDwellMinutes")}
          errorHandler={(e) => console.error("[IZ] Min dwell:", e)}
          forceSelection
          multiselect={false}
          showSelection
          showCounterPill={false}
          placeholder="Min dwell"
        />
        <Dropdown
          value={[settings.zoneTypeId]}
          dataItems={zoneTypeItems}
          onChange={(items: ISelectionItem[]) => {
            const id = items[0]?.id;
            if (id != null) setSettings((s) => ({ ...s, zoneTypeId: String(id) }));
          }}
          errorHandler={(e) => console.error("[IZ] Zone type:", e)}
          forceSelection
          multiselect={false}
          showSelection
          showCounterPill={false}
          placeholder="Import as zone type"
        />
        <span className="iz-muted">
          {devicesLoading
            ? "Loading vehicles…"
            : `${devices.length.toLocaleString()} vehicle${devices.length === 1 ? "" : "s"} in scope · ${existingZones.length.toLocaleString()} existing zones`}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!insideMyGeotab && (
          <Banner type="info" header="Standalone preview">
            Open this page from inside MyGeotab to query live data.
          </Banner>
        )}
        {groupsErr && (
          <Banner type="error" header="Couldn't load groups">
            {groupsErr}
          </Banner>
        )}
        {devicesErr && (
          <Banner type="error" header="Couldn't load vehicles">
            {devicesErr}
          </Banner>
        )}
        {zonesErr && (
          <Banner type="error" header="Couldn't load zones">
            {zonesErr}
          </Banner>
        )}
        {scanErr && (
          <Banner type="error" header={isImporting ? "Import failed" : "Scan failed"}>
            {scanErr}
          </Banner>
        )}
        {notice && (
          <Banner type="success" header="Done">
            {notice}
          </Banner>
        )}
        {progress && (
          <div className="iz-progress">
            <span>{progress.text}</span>
            <div className="iz-progress-bar">
              {progress.pct == null ? (
                <div className="iz-progress-indeterminate" />
              ) : (
                <ProgressBar min={0} max={100} now={progress.pct} />
              )}
            </div>
          </div>
        )}
      </div>

      {meta ? (
        <>
          <Summary meta={meta} existingZones={existingZones.length} clusterRadius={settings.clusterRadius} />
          <SuggestionMap suggestions={suggestions} activeId={activeId} onSelect={setActiveId} />
          <div className="iz-import-bar">
            <Button
              type="primary"
              disabled={busy || selectedCount === 0}
              onClick={() => importList(suggestions.filter((s) => s.selected))}
            >
              {selectedCount ? `Import ${selectedCount} selected as zones` : "Import selected as zones"}
            </Button>
            <span className="iz-muted">
              Edit a name or radius before importing. Showing the top {suggestions.length} by score.
              {dismissedCount > 0 && (
                <>
                  {" "}({dismissedCount} dismissed —{" "}
                  <a href="#" onClick={(e) => { e.preventDefault(); onResetDismissed(); }}>
                    show again
                  </a>
                  )
                </>
              )}
            </span>
          </div>
          {suggestions.length ? (
            <SuggestionTable
              suggestions={suggestions}
              devicesById={devicesById}
              activeId={activeId}
              busy={busy}
              onToggle={(id, checked) => patch(id, { selected: checked })}
              onToggleAll={onToggleAll}
              onRename={(id, name) => patch(id, { name })}
              onRadius={(id, radius) => patch(id, { radius: Math.max(30, Math.min(2000, radius)) })}
              onImportOne={(id) => {
                const c = suggestions.find((s) => s.id === id);
                if (c) void importList([c]);
              }}
              onDismiss={onDismiss}
              onFocus={setActiveId}
            />
          ) : (
            <div className="iz-empty">
              No qualifying locations. Try a longer look-back, a smaller minimum stop count, or a
              larger cluster radius.
            </div>
          )}
        </>
      ) : (
        !isScanning &&
        insideMyGeotab && (
          <div className="iz-empty">
            Pick a group and look-back, then click <strong>Scan fleet</strong>. A 30-day scan of a
            few hundred vehicles takes under a minute.
          </div>
        )
      )}

      <footer className="iz-footer">
        <small>
          Stops come from <code>Trip.stopPoint</code> streamed via <code>GetFeed</code> for every
          vehicle in the selected groups. Stops inside an existing zone are ignored. Score = 40%
          stop frequency (log), 25% distinct vehicles, 20% total dwell (log), 15% distinct days —
          relative to the busiest cluster in this scan. Imported zones are circles of the shown
          radius with <code>mustIdentifyStops</code> on, assigned to the selected groups.
        </small>
      </footer>
    </div>
  );
}
