# Add Privacy Policy to nimbus-api (so the store link works)

Vercel deploys from **https://github.com/leveldesignagency/nimbus-api**.  
That repo has a `public` folder but no `privacy.html`, so  
https://nimbus-api-ten.vercel.app/privacy.html returns 404.

## Fix: add `privacy.html` to the nimbus-api repo

### Option A – Copy from this project (easiest)

1. **Clone the API repo** (if you don’t have it already):
   ```bash
   cd ~/Documents  # or wherever you keep repos
   git clone https://github.com/leveldesignagency/nimbus-api.git
   cd nimbus-api
   ```

2. **Copy the privacy page** from this CursorIQ project into the API repo:
   ```bash
   cp /Users/charlesmorgan/Documents/CursorIQ/vercel-api/public/privacy.html ./public/
   ```

3. **Commit and push**:
   ```bash
   git add public/privacy.html
   git commit -m "Add privacy policy page for Chrome Web Store"
   git push origin main
   ```

4. **Wait for Vercel** to redeploy (usually 1–2 minutes). Then open:
   https://nimbus-api-ten.vercel.app/privacy.html  
   You should see the Nimbus privacy policy.

5. Your extension already uses this URL in `manifest.json` – no change needed there.

---

### Option B – Add the file on GitHub (no local clone)

1. Open: https://github.com/leveldesignagency/nimbus-api
2. Go into the **`public`** folder.
3. Click **“Add file”** → **“Create new file”**.
4. Name the file: **`privacy.html`**
5. Paste in the full contents of **`vercel-api/public/privacy.html`** from this project (or from the copy below).
6. Click **“Commit changes”** (e.g. commit message: “Add privacy policy page”).
7. Wait 1–2 minutes, then check: https://nimbus-api-ten.vercel.app/privacy.html

---

After the page loads, the Chrome Web Store privacy policy link is valid and you can resubmit.
