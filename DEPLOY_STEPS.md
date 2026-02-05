# How to ship an update (Vercel + Chrome)

You have **two separate things** that need updating. Git push only updates one of them.

---

## 1. Vercel (your API) — **does** update from Git (if set up that way)

Your API lives at `nimbus-api-ten.vercel.app`. The code is in the `vercel-api/` folder.

### If Vercel is already connected to your GitHub repo

- **Yes:** Pushing to the branch Vercel watches (usually `main`) will trigger a new deploy.
- Vercel will build and deploy whatever is in that branch. No need to do anything in the Vercel dashboard for each change — just push.

### Check / fix Vercel “root” folder

- In Vercel: **Project → Settings → General**
- **Root Directory** must point at the folder that contains `vercel.json` and `api/`.
  - If your repo root is `CursorIQ` (with a subfolder `vercel-api/`), set Root Directory to **`vercel-api`**.
  - If your repo root is already the API project (only `vercel-api` contents), leave Root Directory **empty**.
- Save. Next deploy will use that root.

### If Vercel is **not** connected to Git

- You’d deploy manually: `cd vercel-api` then `vercel --prod` (after `vercel login`), or use the Vercel dashboard “Import” / “Deploy” for the `vercel-api` folder.

**Summary:** Commit + push **does** update the live API, as long as Vercel is linked to the repo and Root Directory is correct. You don’t re-zip or touch Chrome for this part.

---

## 2. Chrome Web Store (your extension) — **does not** update from Git

The store only updates when **you** upload a new package and submit it. Git has no connection to the Chrome Web Store.

So after you’ve committed and pushed (and Vercel has deployed):

1. **Bump version** in `manifest.json` (e.g. `"version": "1.0.9"`).
2. **Create a zip** of the extension (only the files the extension needs — no `vercel-api`, no `.git`, no docs).
   - You can use `create-store-zip.sh` if it’s set up, or zip by hand: `manifest.json`, `background.js`, `contentScript.js`, `popup.html`, `popup.js`, `options.html`, `options.js`, `tooltip.css`, `assets/`, and any other assets the extension uses.
3. **Chrome Web Store:** [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → your Nimbus extension → **Package** tab → upload the new zip → submit for review.

**Summary:** Commit + push does **not** update the Chrome Web Store. You have to zip the extension and upload/submit in the developer dashboard every time you want users to get a new version.

---

## Quick checklist when you ship a change

| Step | What to do |
|------|------------|
| 1 | Edit code (extension and/or `vercel-api`). |
| 2 | Commit and push to your main branch. |
| 3 | **Vercel:** Wait for the deploy to finish (or trigger it); no zip, no Chrome. |
| 4 | **Chrome:** Bump `manifest.json` version, create zip, upload to Chrome Web Store, submit. |
| 5 | Users get the **API** update as soon as Vercel deploys; they get the **extension** update when Chrome rolls out your new version (usually within hours). |

So: **Git push → Vercel updates. Zip + upload + submit → Chrome updates.** Two separate steps.
