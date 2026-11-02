# HydroSense — persistence, seeded demo records, and portal API repair

This is an **overlay update** for the existing HydroSense repository. It does not replace the project or its existing database schema. It adds a compatibility API for the current browser application, an additive SQLite migration, and an idempotent importer for the supplied `hydrosense_seed.json`.

## What this update contains

- `backend/routes/portal.js` — adapts the existing browser routes (`/api/feed`, `/api/map`, `/api/admin/...`, etc.) to the existing Express/SQLite schema. It also provides report PDF access, news publishing/deletion, authority status/action/inspection updates, and report lookup by Report ID.
- `backend/db/migrate.js` — adds `map_url`, `source_reference`, `is_demo` and news source metadata columns without replacing existing data.
- `backend/db/seedDemo.js` + `backend/db/hydrosense_seed.json` — imports the supplied **14 report records + 14 news items**, their reporter/authority timeline labels, and water-body records. Import is idempotent: existing Report IDs and news references are not overwritten.
- `backend/server.js` — runs the additive migration, optionally imports demo data, and mounts the compatibility routes ahead of the older backend routes.
- `render.yaml` — declares `SEED_DEMO_DATA=true` and leaves the service on Free. It includes comments for optional persistent storage; it does not silently upgrade the service or add a charge.
- `scripts/patch_public_app.py` — applies five small, exact changes to the existing `public/app.js` so the UI sends the backend's required CSRF header, handles missing coordinates, labels imported demo records, provides a Google Maps search link, and shows a PDF link to authorities.

## Important data-provenance rules

The supplied records identify themselves as a **historical/news compilation** and say to verify on site before treating them as current. This update preserves that caveat on report details and news entries. It does not invent GPS coordinates, evidence photos, lab measurements, field inspection results, or source article URLs. The supplied statuses and timeline notes are displayed as imported demo history, not independently verified actions.

The demo users are synthetic system identities named Vedasri, Vidyadevi, Bharani, Akshaya and Abinaya, plus a HydroSense Demo Archive publisher. They use reserved `.invalid` email addresses and random undisclosed passwords, so they are **not login credentials** and cannot receive email. Sign in using your actual citizen or authority account to make edits. Authority updates are stored in SQLite and appear in report timelines.

## Install into the existing GitHub repository

1. Download and extract this ZIP.
2. Merge the included `backend/` files into the same `backend/` folders in `akshayace23-maker/HYDROSENSE`. Do not delete or replace `backend/db/init.js`, `backend/config.js`, your package files, or any current database file.
3. Replace the repository's `backend/server.js` with the included `backend/server.js`.
4. Replace the repository's `render.yaml` with the included `render.yaml` (or manually add the `SEED_DEMO_DATA=true` environment variable in Render if your service is not Blueprint-managed).
5. From the **repository root**, run:

   ```bash
   python scripts/patch_public_app.py
   ```

   This edits only the five targeted parts of `public/app.js`. It refuses to write if the expected source text differs, so it does not silently overwrite a changed frontend.
6. Commit the merged changes to `main` and let the connected Render service deploy.

The repository root has its own `package.json` (`npm start` runs `node backend/server.js`). For this repository, Render's Root Directory should be blank/repository root, Build Command `npm install`, and Start Command `npm start`.

## Render environment and persistence

### Demo data import

In Render → your HydroSense Web Service → Environment, ensure:

```text
SEED_DEMO_DATA=true
```

The next successful start will import the 14 report records and 14 news records if those IDs are not already present. The importer will not overwrite later authority edits to existing IDs.

### Why records disappear on the current Free plan

The backend stores its SQLite database and uploaded evidence on the service's local filesystem. Render documents that Free web services have an ephemeral filesystem; local SQLite databases and uploaded files are lost on redeploy, restart, and spin-down. Free web services cannot attach persistent disks. Therefore, **the seed importer restores the supplied demo records after a reset, but it cannot preserve new citizen submissions, authority edits, or uploaded photos on the Free plan**.

For durable SQLite + photo storage, upgrade the existing web service to a paid compute plan and attach a persistent disk mounted at `/var/data`. Then add these environment variables:

```text
DB_PATH=/var/data/hydrosense.db
UPLOAD_DIR=/var/data/uploads
```

Only data written under the disk mount is persistent. Back up any existing data before changing storage paths; an existing SQLite database is not automatically copied to the new mount. Do not upgrade or attach a paid disk unless you approve the cost. Render's current pricing page lists its smallest paid compute option at $7/month and persistent SSD storage at $0.25/GB/month; confirm the current price in your dashboard before proceeding.

## After deployment: verification checklist

1. Open `https://YOUR-SERVICE.onrender.com/healthz` — expect `{"ok":true}`.
2. Open `/api/public-stats` — expect JSON counters, including the imported reports.
3. Open `/api/news` — expect the imported historical/demo news items.
4. Open `/api/map` — imported items without GPS coordinates must **not** appear as fabricated map markers. Their report pages include a location description and a Google Maps search link instead.
5. Sign in with a real authority account and open a report such as `HS-TRY-001`. Change its status/priority, add an authority remark, record an inspection only when actually performed, or record an action only when actually carried out. The updates appear in the report timeline.
6. On a report detail page, an authority account can download its PDF using the `PDF` link.
7. Submit a new citizen report and then reopen/refresh it. For durable retention across restarts, complete the persistent-disk steps above first.

## Validation performed on this package

- `node --check` passed for `backend/server.js`, `backend/routes/portal.js`, `backend/db/migrate.js`, and `backend/db/seedDemo.js`.
- The demo-import SQL was checked against a SQLite test schema: 14 reports, 14 news posts, 9 water-body records, 37 timeline events, 3 action-history entries, and 6 synthetic demo identities were created.
- A full live integration test against your Render deployment was not possible here. The code is prepared for you to deploy and verify; this ZIP is **not yet committed to your GitHub branch**.
