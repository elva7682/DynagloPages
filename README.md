# DYNA / GLO Spacecraft ATS Dashboard

Static, client-side schedule visualization for GitHub Pages. No database, API keys, server, or build process needed.

## Features

- Mission tabs: **DYNA** and **GLO**, each with its own schedule data, clocks, event list, and 24-hour UTC timeline.
- Top **CURRENT EVENT:** card shows the last scheduled event whose start is at or before the current time, including UTC / Mountain start times and elapsed time. Before the first start it displays 'Awaiting first event'. After the last start, it continues showing the last event (not actual spacecraft telemetry).
- The next three events display live countdowns; Mountain Time uses the `America/Denver` time zone with DST handling.
- Timeline lanes and full table for DAYGLOW, AURORA, ECLIPSE, IDLE, XBAND DOWNLINK (HDR_ATT), and UHF POINTING (UHF_ATT). `_START` suffixes are removed; other names such as `_CONT` are shown with spaces instead of underscores.
- Search, filters, UTC day navigation, live now line, and marker-to-table navigation.

## Publish

1. Make a public GitHub repository, such as `spacecraft-schedule`.
2. Upload `index.html`, `app.js`, `style.css`, and your `.prc` files to the repository root.
3. In **Settings → Pages**, select **Deploy from a branch**, branch **main**, folder **/(root)**, and save.
4. Open `https://YOUR_USERNAME.github.io/spacecraft-schedule/`.

## Loading schedules

The site automatically loads these **optional** files from the repository root:

- `dyna_ats_26_301.prc`: included example DYNA schedule.
- `glo_schedule.prc`: optional GLO schedule (add it yourself).
- `dynaglo_schedule.prc`: optional shared schedule, applies to both missions.

For your own permanent schedules, you can rename the DYNA ATS to `dyna_ats_26_301.prc` or edit the array in the `loadBundled()` function of `app.js` to match your new filenames. Similarly, place your GLO or shared file under the names above. The sample `examples/dyna_ats_26_291.prc` is supplied as a reference only and is **not** automatically loaded.

Alternatively, use **Upload .prc (one or more)** in the browser. This updates the view only in your current browser session; it does not upload to GitHub or persist across page refreshes.

**Filename mission routing (case-insensitive):**

- Contains `dynaglo_`: installs the file for both DYNA and GLO.
- Contains `dyna_` (but not `dynaglo_`): installs it for DYNA.
- Contains `glo_` (but not `dynaglo_`): installs it for GLO.

The original ATS filename is used for this determination, regardless of the `CMD GLO` or `CMD DYNA` commands inside the schedule. If several files target the same mission, the last loaded one wins. Upload files for both missions together if desired; use tabs to switch between them.

## Parsing and timing

For each `; NVM_SMALL## - EVENT_NAME` header, the parser requires an `absolute suspend until YYYY/DDD-HH:MM:SS` comment, a `SEQ_SUSPEND_ABS` command, and a matching `SEQ_CALL` referring to the same NVM buffer. `NONE - ATS_START` and `ATS_END` are not displayed as events. All schedule timestamps are interpreted as UTC.

Events are scheduled commands, **not evidence that flight software executed them successfully**. The current-event label means the most recently scheduled event start, not a live operational mode. The device's time drives the displays.

To preview locally, use a small local static server such as `python -m http.server 8000`, then open `http://localhost:8000` (loading the HTML via `file://` may block fetching `.prc` files).

## Event display names and durations

Event names ending in `_START` or `_CONT` are displayed without those suffixes. `HDR_ATT` displays as XBAND DOWNLINK; `UHF_ATT` displays as UHF POINTING.

Each event duration is calculated as the time from its scheduled start to the **next event start**, including events with the same timestamp (0 seconds). Durations are displayed as HH:MM:SS, prefixed with days for spans longer than 24 hours. The final event displays an em dash (`—`), because no following event timestamp exists. Duration represents time between scheduled events, not actual command execution duration.


## Live DYNA / GLO TLE ground track

The **Schedule Overview** panel has been replaced by a satellite map. It appears on both spacecraft tabs and shows both DYNA (cyan) and GLO (gold), emphasizing the selected spacecraft. Browser-side **SGP4** calculations convert uploaded two-line elements into sub-satellite latitude/longitude and altitude. Markers update every 15 seconds; +/- 90-minute predicted tracks redraw every minute. Dashed lines show the previous 90 minutes, solid lines the next 90 minutes. Tracks are split at the international date line instead of connecting across the map. Zoom and pan with the map controls.

Place **DYNA_TLE.txt** and **GLO_TLE.txt** (included with the site) in the repository root. Files may be `.txt` or `.tle`. Default recognized files are `DYNA_TLE.txt`, `GLO_TLE.txt`, `DYNA_TLE.tle`, and `GLO_TLE.tle`. For arbitrary additional filenames, create `tle-files.json` containing an array such as `["DYNA_2026_11_01.tle", "GLO_2026_11_01.txt"]` and commit the named files too; the last loaded matching file is used. File names containing `DYNA` are associated with DYNA, `GLO` with GLO, and `DYNAGLO` with both. You can also click **Upload TLE(s)** inside the map panel to load files temporarily into your browser (this does not save to GitHub). **Reload** reads the files in the repository again.

**Important:** The two example TLE files provided contain exactly the same orbital elements (NORAD 60182, epoch October 27, 2026), so the predicted positions and tracks coincide until distinct TLEs are provided. The map warns you when this happens. TLEs describe predicted position, not telemetry; accuracy degrades as the elements age. The display shows age in days. The website needs internet access to load Leaflet, satellite.js, and OpenStreetMap tiles. All propagation happens locally in the browser. 

## Orbital-altitude eclipse overlay

The world map shades the **selected mission's orbital shell**, not the Earth surface night side. A dark region represents full Earth **umbra** (the entire solar disk is occluded by Earth); a violet fringe denotes **penumbra** (partial solar occultation). The shell radius is Earth radius plus the currently SGP4-propagated spacecraft altitude and the illumination geometry is recomputed each minute and when the map is navigated. Toggle DYNA or GLO to show the respective orbital shell; both spacecraft markers always remain visible.

Each spacecraft's details and marker popup independently display **SUNLIT**, **PARTIAL ECLIPSE**, or **IN ECLIPSE (umbra)** based on its propagated three-dimensional position and the geometric angular overlap of Earth and Sun as seen from the spacecraft. The shadow is calculated from an approximate Sun ephemeris, spherical Earth, and a point on a constant-altitude shell. It does not account for atmospheric refraction, terrain, or the Earth's oblateness. The map shade represents locations where a satellite *at that altitude* would be eclipsed; it is not the ground-level terminator. Satellite positions are predictions from TLEs, not onboard telemetry.


## Troubleshooting: Ground track missing

The ground-track map must have `groundtrack.js`, `index.html`, and the style sheet in the same published directory. The HTML loads Leaflet and satellite.js via external CDNs, so network filtering can prevent initialization. The `tleStatus` text near the map now reports missing libraries.

When updating GitHub Pages, check **Settings > Pages** to verify the published branch and folder, then open the live page, use **Ctrl+Shift+R** and inspect the page source for `groundtrack.js?v=20261029b`. If that file isn't in page source, GitHub Pages is still publishing the old HTML or a different folder/branch. Use DevTools > Network for any 404s or blocked CDN scripts.


## Wide ground-track map

The ground-track panel now spans the dashboard width, with a dark map by default and display settings for map style, spacecraft visibility, track visibility, labels, eclipse overlay and opacity. The eclipse overlay models occultation at the selected spacecraft's orbital altitude; it is **not** the surface night region. The rest of the schedule features remain unchanged.


## Reference-inspired ground track update
The full-width vector map defaults to a dark, country-outlined projection; switch to tiled basemaps in Display Settings. Ground stations are loaded from `ground-stations.json` (based on the provided LSN CSV). Satellite footprints are geometric line-of-sight horizon boundaries at zero elevation, plotted around the instantaneous satellite subpoint. Satellite labels, station labels, visibility footprints, orbit tracks and eclipse overlay can be toggled. The altitude-adjusted eclipse shading remains calculated in browser from finite Sun/Earth angular geometry rather than ground sunlight. This uses `topojson-client` and the `world-atlas` dataset via jsDelivr, as well as Leaflet and satellite.js.

The supplied Python backend described an additional `web/` folder containing frontend HTML/JS/CSS, but those three frontend files were not included in the upload; this version reproduces the visible presentation within the existing schedule website instead of claiming a verbatim port.


## Reference-style map / ±40° update

The map adopts the supplied ground-track reference's dark vector map palette and monospaced mission-display styling. Ground-station markers and satellite visibility footprints (horizon rings) are removed. Two high-visibility geographic parallels at **40° N (magenta)** and **40° S (cyan)** stay fixed on the map. The eclipse overlay continues to use the DYNA or GLO **orbital shell** and the 3D Sun/Earth occultation calculation, rather than the reference's surface-based nautical twilight calculation. All TLE propagation remains browser-based, so GitHub Pages does not require a Python backend.
