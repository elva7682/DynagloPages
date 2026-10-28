# DYNA Spacecraft Schedule Viewer

A fully static spacecraft schedule viewer for GitHub Pages. No backend or external dependencies.

## Deployment

1. Create a public GitHub repository, for example `spacecraft-schedule`.
2. Add `index.html`, `style.css`, `app.js`, and `schedule.prc` to the repository root.
3. On GitHub, go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
4. Select **main** and **/(root)**, then save.
5. Open `https://YOUR_USERNAME.github.io/spacecraft-schedule/` after GitHub publishes the site.

If you want the site at `https://YOUR_USERNAME.github.io/`, name the repository `YOUR_USERNAME.github.io`.

## 24-hour timeline

The timeline defaults to the current **UTC** calendar day and advances automatically at UTC midnight. Use Previous, Next, and Today (UTC) to browse other dates. Event starts appear as color-coded dots in separate DAYGLOW/AURORA/ECLIPSE lanes. Closely spaced events are grouped into a numbered marker; hover to read timestamps, or click to scroll to the first event in the group in the full event table. A pink vertical line tracks live UTC time on the current day. The date range below the title shows the corresponding Mountain Time window, including automatic MDT/MST transitions.

## Updating the schedule

To update the schedule for all visitors, replace `schedule.prc` in your repository with the new ATS file. Users can refresh or press **Reload** to retrieve it. The **Upload .prc** control loads a local file temporarily for just that visitor; it does not upload or publish the file to GitHub.

## How times and events are interpreted

Each event must have a semicolon-comment header such as `; NVM_SMALL69 - DAYGLOW_START`, followed by a comment `; absolute suspend until 2026/301-14:00:20`, an actual `CMD DYNA SEQ_SUSPEND_ABS` instruction, and a `CMD DYNA SEQ_CALL ... BUFFID NVM_SMALL69` instruction. The buffer identifiers must match. `NONE - ATS_START` and `NONE - ATS_END` are ignored.

The comment's YYYY/DDD-HH:MM:SS timestamp is interpreted as UTC (DDD = day of year). The numeric `TIME ... DN` field is deliberately not used, because its epoch is mission-specific. Start times are scheduled command times, **not confirmed spacecraft execution**. "PASSED" means the scheduled start time has passed, not that execution succeeded. Events with duplicate names are retained. The schedule end/start range is taken from the ATS header, when present; otherwise from the first and last parsed event. Mountain Time is `America/Denver` (MDT/MST, with automatic daylight-saving transition).

Countdowns show `HH:MM:SS` until 24 hours, then `Xd HH:MM:SS`, so they stay readable for multi-day events. All countdowns and statuses refresh once per second according to the viewer's local device clock.

## Local testing

To run locally, open a terminal in this folder and run:

```shell
python -m http.server 8000
```

Open `http://localhost:8000/`. Opening `index.html` directly from the filesystem may block loading `schedule.prc` because of browser security rules. You can still use Upload .prc.

## Caveats

A public GitHub repository and its published `.prc` are publicly accessible. Review the file for sensitive information before publishing. Anyone visiting the page can see the schedule and its event times. The site is purely static; it does not poll Outlook, ingest live telemetry, or automatically receive newly generated schedules unless you commit a replacement schedule to GitHub.
