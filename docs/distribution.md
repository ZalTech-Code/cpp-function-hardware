# Distributing the Dashboard to Students

The dashboard is a **static, client-side app**. It runs entirely in the browser
and talks to a board plugged into **the same computer** over Web Serial. There is
no shared server and no shared data — each student connects to **their own board
on their own machine**.

So "distributing to 5 users" just means getting the files (or a link) onto each
machine. Pick one of the options below.

## Two hard requirements (tell every student)
1. **Browser:** Chrome, Edge, or Opera (any Chromium browser). Web Serial does
   **not** work in Firefox or Safari.
2. **Secure context:** Web Serial only runs from `https://`, `localhost`, or a
   local `file://` page. Double-clicking `index.html` (a `file://` page) counts,
   which is why the zip option below works offline.

Each student also needs: their own board, the firmware flashed (with the right
board picked in `examples/board_config.h`), and the USB driver (CH340/CP210x for
ESP32) if their OS doesn't auto-install it.

---

## Option A — Zip and share (simplest, fully offline)
Best for a one-off workshop of a few people.

1. Zip the `dashboard/` folder. You only need these three files:
   - `index.html`
   - `style.css`
   - `dashboard.js`
2. Send the zip by email, USB stick, or a shared drive.
3. Each student unzips it, keeping the three files **together in one folder**.
4. They double-click `index.html`; it opens in their default browser. If that's
   not Chrome/Edge, right-click -> "Open with" -> Chrome or Edge.

Pros: no internet, no install, no accounts.
Cons: if you change the dashboard later, you re-send the zip.

> Keep the three files in the same folder. `index.html` loads `style.css` and
> `dashboard.js` by relative path, so splitting them up breaks the page.

---

## Option B — Host once, share one link (easiest to update)
Best if the class is recurring or you expect to tweak the dashboard. Uses free
static HTTPS hosting. Web Serial works fine over HTTPS.

### B1. GitHub Pages
> Prefer click-by-click with no terminal? See **`docs/github_pages_setup.md`**
> for the full web-upload walkthrough.

1. Create a GitHub repo and upload the `dashboard/` files (or the whole project).
2. Repo **Settings -> Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**, pick your
   branch (e.g. `main`) and folder (`/root` or `/docs` — wherever the dashboard
   `index.html` lives).
4. Save. After a minute GitHub gives you a URL like
   `https://<user>.github.io/<repo>/`.
5. Share that URL. Students bookmark it. To update, push a new commit — everyone
   gets the latest automatically.

> If you publish the whole project, the dashboard URL will include the path,
> e.g. `https://<user>.github.io/<repo>/dashboard/`.

### B2. Netlify (drag-and-drop, no git needed)
1. Go to app.netlify.com -> **Sites** -> drag the `dashboard/` folder onto the
   "deploy" area.
2. Netlify gives you an HTTPS URL instantly.
3. Share it. To update, drag the folder again.

Pros: one link, instant updates, real HTTPS.
Cons: needs internet; a free account for the host.

---

## Option C — One machine serving the LAN (usually NOT worth it)
You might think "I'll run a local server and have everyone connect to it." This
**does not work** for Web Serial across machines:

- `python -m http.server` serves plain `http://` over the LAN.
- Web Serial is blocked on plain `http://` (non-secure context).
- Only the host machine (via `localhost`) would have a secure context.

Making it work would require setting up HTTPS with a real or self-signed
certificate on the LAN — overkill for 5 students. Use Option A or B instead.

---

## Quick recommendation
- **One-off / small workshop:** Option A (zip the three files).
- **Recurring class or you'll keep editing it:** Option B (GitHub Pages or
  Netlify — one link, easy updates).

## Common gotchas
- **"Web Serial not supported":** they're not in a Chromium browser.
- **Page opens but looks unstyled / buttons dead:** the three files got
  separated; keep `index.html`, `style.css`, `dashboard.js` together.
- **Port not listed when connecting:** missing USB driver, or the Arduino IDE's
  Serial Monitor is still holding the port — close it.
- **Board not auto-detected:** connect, then press the board's reset button so it
  re-sends its `BOARD;` line, or pick the board manually in the dropdown.
