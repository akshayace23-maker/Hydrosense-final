# Render persistence settings for HydroSense

The existing application uses local SQLite and local uploads. The Render Free web-service filesystem is ephemeral, so new reports and photos disappear on restarts, redeploys and idle spin-down. Demo records can be re-seeded, but user-entered updates cannot be made durable on Free.

## Durable SQLite option

1. In Render Dashboard, open the existing HydroSense Web Service.
2. Upgrade the service to a paid compute plan (do not proceed unless the cost is approved).
3. Open the service's **Disks** page and add a persistent disk mounted at `/var/data`.
4. Under **Environment**, add:
   - `DB_PATH` = `/var/data/hydrosense.db`
   - `UPLOAD_DIR` = `/var/data/uploads`
   - `SEED_DEMO_DATA` = `true`
5. Save and deploy. On first boot, the app creates the database and upload directory under the mount and seeds the demo records if absent.

Important:
- Only files under `/var/data` persist.
- Existing ephemeral SQLite data is not automatically copied to the new disk. Back up any wanted records before changing paths.
- Persistent disks are available to paid services, not Free web services.
- A disk-backed single SQLite database is suitable for a single-instance prototype. Do not scale the web service to multiple instances while relying on this one local SQLite disk.
