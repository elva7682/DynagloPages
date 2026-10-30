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
