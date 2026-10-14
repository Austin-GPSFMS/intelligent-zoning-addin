# Intelligent Zoning — MyGeotab Add-In

A GPSFMS re-creation of Geotab's retired **Intelligent Zoning** feature (Analytics Lab experiment, later the "New Zones" card in Active Insights). It finds the places a fleet stops most often that aren't covered by a zone yet, scores them by activity, and lets the user review, rename, resize, and import them into the database as zones.

What the original did, and what this does:

| Original (Geotab) | This add-in |
|---|---|
| Records areas with high stop frequency across the fleet | Pulls every `Trip.stopPoint` for the selected group over a 7–90 day look-back |
| Suggests zones with a score "based on the magnitude of activity" | Clusters stops by proximity, scores 0–100 (see below) |
| Shows the first 100 suggestions | Shows the top 100 by score, with map + table |
| Import directly into MyGeotab | Import selected (or one at a time) via `Add Zone` |
| Refreshed monthly by Geotab | Run on demand; dismissed suggestions are remembered per browser |

## Files

| File | Purpose |
|------|---------|
| `config.json` | Add-In manifest (registers the page under **Zones & Messages**) |
| `intelligentZoning.html` | UI shell |
| `intelligentZoning.js` | All logic: API calls, zone exclusion, clustering, scoring, geocoding, map, import, CSV |
| `styles.css` | Styling |
| `build.py` | Produces the two distributable forms below |
| `intelligentZoning.standalone.html` | Single-file build (CSS + JS inlined) for GitHub / jsDelivr hosting |
| `config.hosted.json` | Manifest pointing at the jsDelivr-hosted standalone file |
| `config.packed.json` | Manifest with all files base64-inlined — upload-and-go, no hosting |

## Install

### Hosted (recommended — same pattern as Engine Hours by Zone)

1. Push this folder to `github.com/Austin-GPSFMS/intelligent-zoning-addin` (branch `main`).
2. In MyGeotab → **Administration → System… → System Settings → Add-Ins → New Add-In**, paste `config.hosted.json`.
3. Save, refresh. The page appears under **Zones & Messages → Intelligent Zoning**.

jsDelivr caches `@main` for up to 12 hours. To force a refresh after pushing, either purge (`https://purge.jsdelivr.net/gh/Austin-GPSFMS/intelligent-zoning-addin@main/intelligentZoning.standalone.html`) or pin a tag/commit in the URL.

### Packed (no external hosting)

Paste `config.packed.json` into the New Add-In dialog instead. Rebuild it after any source change with `python3 build.py`.

### Local development

```bash
cd intelligent-zoning-addin
python3 -m http.server 8080
```

Use a dev manifest with `"url": "http://localhost:8080/intelligentZoning.html"`. If the database blocks mixed content, serve over https (mkcert) or use the hosted path.

## How it works

1. **Load statics** — one `multiCall`: `Get Device`, `Get Group`, `Get Zone`, `Get ZoneType`. Every existing zone gets a bounding box for a fast point-in-polygon pre-check.
2. **Fetch stops** — devices in the chosen group are queried 25 at a time (`multiCall` of `Get Trip` with `fromDate`/`toDate`). A `propertySelector` limits each trip to `device, driver, stop, nextTripStart, stopPoint, stopDuration` to keep payloads small; if the server rejects the selector the batch is retried without it. Each trip is immediately reduced to a stop record and the trip object is dropped, so memory stays flat on big fleets.
3. **Exclude** — a stop whose `stopPoint` falls inside any existing zone (ray-cast point-in-polygon after the bbox check) is counted but discarded. Stops shorter than *Min dwell* are discarded too.
4. **Cluster** — greedy centroid clustering on a lat/lng grid index (cells = cluster radius, 3×3 neighbourhood search), followed by a merge pass where larger clusters absorb smaller ones within the radius. ~300k stops cluster in under 2 s.
5. **Summarise** — stops, distinct vehicles, drivers, days, total/avg dwell, first/last visit, and a suggested zone radius = `clamp(p90 stop distance × 1.25 + 25 m, 60 m, cluster radius)` rounded to 10 m.
6. **Score** — relative to the strongest cluster in the run:

   `score = 100 × (0.40·log(stops) + 0.25·vehicles + 0.20·log(dwell hours) + 0.15·days)` — each term normalised 0–1.

   A "looks like" hint (Yard / depot, Overnight parking, Fuel / quick stop, Customer / job site, Frequent stop) is derived from average dwell and fleet share. It's a label, not a zone type — the import type is chosen in the toolbar.
7. **Filter** — Min stops, Min vehicles, and previously dismissed clusters; top 100 by score.
8. **Geocode** — `GetAddresses` in batches of 50; the street (or city) becomes the default zone name.
9. **Import** — `Add Zone` per selected row in one `multiCall`. Each zone is a 24-vertex circle of the row's radius, assigned to the selected zone type and the selected vehicle group, `displayed: true`, `mustIdentifyStops: true`, with a comment recording the stats behind the suggestion. Imported zones are added to the in-memory exclusion list so a re-scan won't suggest them again.

## API calls per scan

| Call | Count |
|------|-------|
| `Get` Device / Group / Zone / ZoneType | 1 multiCall |
| `Get` Trip | ⌈devices ÷ 25⌉ multiCalls |
| `GetAddresses` | ⌈suggestions ÷ 50⌉ (≤ 2) |
| `Add` Zone | 1 multiCall per import click |

A 300-vehicle database is 12 trip multiCalls. Transfer size is the practical limit, not call count: at 30 days a 300-vehicle fleet is roughly 100–150k trips. Use a shorter look-back or a sub-group for very large databases.

## Settings persistence

Scan settings and the dismissed list are stored in `localStorage` (`gpsfms.intelligentZoning.*`), so they are per browser, not per database user. "Show dismissed again" in the toolbar clears the list.

## Map

Leaflet 1.9.4 + OpenStreetMap tiles are loaded from unpkg / openstreetmap.org at runtime. The standalone build includes the tags directly; the packed build injects them from JS (`ensureLeaflet`). If the CDN is unreachable the table still works and each row has a "Map ↗" link.

## Known limitations / ideas

- **Circle zones only.** Convex-hull zones for irregular sites (landfills, laydown yards) would be a small addition — the stop points per cluster are already kept on each suggestion.
- **No per-user persistence.** Dismissals could move to `AddInData` so they follow the user across browsers and are visible to colleagues.
- **No scheduling.** The original refreshed monthly. A Python job using the same logic could email a monthly "new zone candidates" CSV per database.
- **Stops on open-ended trips** (no `nextTripStart` yet) fall back to `stopDuration`, which may be 0 for an in-progress stop and get filtered by Min dwell.
- **Zone nesting.** Stops inside an existing zone are excluded even if that zone is huge (e.g. a city-wide zone). Narrow the exclusion by zone type if that becomes a problem.
