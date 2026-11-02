# "I See This Too" — Community page (add-on)

What it adds: a **Community** page (`/community.html`) listing open reports with a one-tap **I See This Too** button,
a "Community" link in the top menu and footer, a "See open reports" button on the home page, and clearer messages on the report page.

## Easiest way — copy the files (2 minutes)
Copy these files from this folder into your project, **replacing** the ones with the same name:

| File in this folder | Goes to (in your GitHub repo) | New or replace |
|---|---|---|
| public/community.html | public/community.html | NEW |
| public/js/pages/community.js | public/js/pages/community.js | NEW |
| backend/routes/reports.js | backend/routes/reports.js | replace |
| public/js/core.js | public/js/core.js | replace |
| public/index.html | public/index.html | replace |
| public/js/pages/report-detail.js | public/js/pages/report-detail.js | replace |
| public/js/lang/ta.js | public/js/lang/ta.js | replace |

On GitHub: open the folder, click **Add file → Upload files**, drop the file in, **Commit changes**.
(For a file inside a folder, open that folder first, then upload.) Render redeploys by itself.

## If you edited those files yourself and cannot replace them — 3 small edits
1. **backend/routes/reports.js** — paste the whole block that begins `// ---------- COMMUNITY LIST (public)` from the file
   in this folder **directly above** the line `// ---------- ALERTS (authority)`. It must stay above `router.get('/:id', ...)`.
   Also change `router.post('/:id/confirm', authRequired, confirmLimiter,` to
   `router.post('/:id/confirm', authRequired, requireRole('citizen'), confirmLimiter,`.
2. **public/js/core.js** — in `const NAV = [ ... ]` add `['/community.html', 'Community'],` after the Track entry;
   in the footer "Explore" links add `<a href="/community.html">Community Reports</a>`.
3. **public/index.html** — under the "I See This Too" card paragraph add:
   `<a href="/community.html" class="btn btn-outline btn-sm" style="margin-top:12px;">See open reports →</a>`

Add the two NEW files exactly as given, and the Tamil lines in ta.js are optional (English works without them).

## How to use it
- Citizens: **Community** → find a report that matches what you see → **I See This Too**. You cannot confirm your own report or confirm twice.
- 5 confirmations raise a report to high priority automatically.
- Guests see the counts and a "Log in to confirm" button. Authorities see the counts only.
- The map popup and the duplicate warning on the Report page still have the same button.
