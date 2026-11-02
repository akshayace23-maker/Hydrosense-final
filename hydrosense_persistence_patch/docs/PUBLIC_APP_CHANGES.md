# Browser frontend changes

The existing `public/app.js` is retained. Run `python scripts/patch_public_app.py` from the repository root after copying the package files. The script makes these targeted updates only:

1. Change the write-request header to `X-Requested-With: HydroSense`, which is the header required by `backend/middleware/auth.js`.
2. Add an authority-only PDF link on each report detail page.
3. Display a clearly labeled historical/demo warning on imported report details.
4. Guard report and water-body detail pages against missing latitude/longitude and show the supplied Google Maps search link instead.

No other page layout, navigation, or existing business logic is replaced.
