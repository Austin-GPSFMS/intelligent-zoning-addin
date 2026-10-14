# Intelligent Zoning — MyGeotab Add-In

Vite + React + TypeScript + Zenith MyGeotab add-in that re-creates Geotab's
retired **Intelligent Zoning** feature (Analytics Lab experiment, later the
"New Zones" card in Active Insights). It finds the places a fleet stops most
often that aren't covered by a zone yet, scores them by activity, and lets the
user review, rename, resize, and import them into the database as zones.

Mirrors the same stack and conventions as `engine_hours_zone` and
`advanced_report_builder`.

| Original (Geotab) | This add-in |
|---|---|
| Records areas with high stop frequency across the fleet | Streams every `Trip.stopPoint` for the selected groups over a 7–90 day look-back |
| Suggests zones with a score "based on the magnitude of activity" | Clusters stops by proximity, scores 0–100 (see below) |
| Shows the first 100 suggestions | Top 100 by score, Leaflet map + review table |
| Import directly into MyGeotab | Import selected (or one at a time) via `Add Zone` |
| Refreshed monthly by Geotab | Run on demand; dismissed suggestions are remembered per browser |

## Project layout

```
intelligent-zoning-addin/
├── package.json
├── tsconfig.json
├── vite.config.ts          ← base: "" produces clean relative asset paths
├── index.html              ← Vite entry shell
├── config.json             ← MyGeotab Add-In manifest (Zones & Messages menu)
├── .nojekyll               ← keeps GitHub Pages from filtering _-prefixed files
├── dist/                   ← committed build output served by GitHub Pages
└── src/
    ├── main.tsx            ← lifecycle wiring (geotab.addin.intelligentZoning)
    ├── App.tsx             ← page: toolbar + banners + summary + map + table
    ├── types.ts            ← GeotabApi, Trip, Zone, Stop, Cluster, Suggestion…
    ├── styles.css          ← imports Zenith CSS + GPSFMS brand tokens
    ├── api/
    │   └── geotab.ts       ← promise wrappers, GetFeed trip stream, zones, geocode, Add Zone
    ├── utils/
    │   ├── cluster.ts      ← grid-indexed greedy clustering, summary, score, classify
    │   ├── geo.ts          ← haversine, point-in-polygon, circle polygon
    │   ├── scan.ts         ← the scan pipeline
    │   ├── storage.ts      ← localStorage (settings, dismissed)
    │   ├── format.ts       ← TimeSpan parsing, duration/date formatting
    │   └── export.ts       ← CSV export
    └── components/
        ├── GroupFilterPicker.tsx ← Zenith GroupsFilter (ported from EHZ)
        ├── Summary.tsx           ← Zenith SummaryTiles
        ├── SuggestionMap.tsx     ← Leaflet map (circles sized to import radius)
        └── SuggestionTable.tsx   ← review/edit/import table
```

## Install & build (Windows PowerShell)

```powershell
cd C:\Users\User\Projects\intelligent-zoning-addin
npm install
npm run build
```

Build output lands in `dist/`. Hashed asset filenames prevent MyGeotab's iframe
cache from going stale silently. `npm run dev` serves at `http://localhost:5173`
with a "Standalone preview" banner (no MyGeotab API outside MyGeotab).

## Push to GitHub & enable Pages

```powershell
git add .
git commit -m "v2.0.0: rebuild on Vite/React/TypeScript/Zenith; GetFeed trip stream"
git push
```

Then enable GitHub Pages (once):

1. https://github.com/Austin-GPSFMS/intelligent-zoning-addin/settings/pages
2. **Source**: Deploy from a branch · Branch `main` · Folder `/ (root)` · **Save**

After ~30 s the page is live at
`https://austin-gpsfms.github.io/intelligent-zoning-addin/dist/index.html`
(already baked into `config.json`).

## Install in MyGeotab

1. Copy the contents of `config.json`.
2. MyGeotab → **Administration → System… → System Settings → Add-Ins**.
3. Remove the previous "Intelligent Zoning" entry if present (the v1 jsDelivr one).
4. **New Add-In**, paste, **OK**, **Save**, hard refresh (Ctrl+Shift+R).
5. Menu item appears under **Zones & Messages → Intelligent Zoning**.

## How it works

1. **Load** — `Get Group`, `Get Zone` (bbox precomputed per zone), `Get ZoneType`; `Get Device` scoped to the selected groups (server resolves descendants).
2. **Stream trips** — `GetFeed Trip` from `fromDate`, 50,000 per call, paging on `toVersion` until an empty page. A `propertySelector` trims each trip to `device, driver, stop, nextTripStart, stopPoint, stopDuration` (retried without it if the server rejects it). Every trip is reduced to a stop record immediately; the trip array is never retained. Trips for devices outside the selected groups, or with `stop` before the window, are skipped.
3. **Exclude** — stops shorter than *Min dwell*, and stops whose `stopPoint` is inside any existing zone (bbox check → ray-cast point-in-polygon).
4. **Cluster** — greedy centroid clustering on a lat/lng grid index (3×3 neighbourhood), then a merge pass where larger clusters absorb smaller ones within the radius. ~300k stops in under 2 s.
5. **Summarise** — stops, distinct vehicles/drivers/days, total/avg dwell, first/last visit, suggested radius = `clamp(p90 stop spread × 1.25 + 25 m, 60 m, cluster radius)`.
6. **Score** — relative to the strongest cluster in the run: `100 × (0.40·log(stops) + 0.25·vehicles + 0.20·log(dwell h) + 0.15·days)`, each term normalised 0–1. A "looks like" hint (Yard / depot, Overnight parking, Fuel / quick stop, Customer / job site, Frequent stop) comes from average dwell and fleet share — it's a label, the import zone type is chosen in the toolbar.
7. **Filter** — Min stops, Min vehicles, previously dismissed; top 100.
8. **Geocode** — `GetAddresses` in batches of 50; the street (or city) becomes the default zone name.
9. **Import** — one `multiCall` of `Add Zone`. Each zone is a 24-vertex circle of the row's radius, assigned to the selected zone type and the selected groups, `displayed: true`, `mustIdentifyStops: true`, with a comment recording the stats behind the suggestion. Imported zones join the in-memory exclusion list so a re-scan won't suggest them again.

## API quota

MyGeotab allows ~1000 calls per user per minute and every child of a
`multiCall` counts. v1 queried trips per device (one call per vehicle) and
tripped the limit on the pilot database. v2 streams the whole database's trips
with `GetFeed` and filters client-side:

| Call | Count per scan |
|------|----------------|
| `Get` Group / Zone / ZoneType / Device | 4 |
| `GetFeed` Trip | ⌈trips in window ÷ 50,000⌉ + 1 |
| `GetAddresses` | ≤ 2 |
| `Add` Zone | 1 multiCall per import click |

A 30-day scan of a 500-vehicle database is roughly 10 calls. Transfer size is
the practical limit — start with 14–30 days on big databases.

## Settings persistence

Scan settings and the dismissed list live in `localStorage`
(`gpsfms.intelligentZoning.*`) — per browser, not per MyGeotab user. "Show
again" in the import bar clears the dismissed list.

## Known limitations / ideas

- **Circle zones only.** Convex-hull zones for irregular sites would be a small addition — stop points per cluster are already kept on each suggestion.
- **No per-user persistence.** Dismissals could move to `AddInData` so they follow the user across browsers.
- **No scheduling.** The original refreshed monthly; a Python job on the same logic could email a monthly "new zone candidates" CSV per database.
- **Zone nesting.** Stops inside any existing zone are excluded, including very large ones (city-wide zones). Narrow exclusion by zone type if that becomes a problem.
