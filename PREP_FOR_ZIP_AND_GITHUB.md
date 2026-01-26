# Prep for Zip, Commit & Push to GitHub

## 1. Create the Chrome Web Store zip

From the project root:

```bash
./create-store-zip.sh
```

This produces `nimbus-v1.0.23-store.zip` (or whatever `version` is in `manifest.json`). That zip is ready to upload to the Chrome Web Store. It’s ignored by git via `.gitignore`.

---

## 2. Commit and push to GitHub

### Option A – Add everything except ignored files

```bash
git add -A
git status   # review: zips, .env, zimAfVIV should not appear
git commit -m "Your message, e.g. v1.0.23: entity sources, settings overlay fix, search placeholder"
git push -u origin main
```

### Option B – Add only extension + essential files

```bash
git add manifest.json popup.html popup.js options.html options.js background.js contentScript.js tooltip.css assets/
git add .gitignore create-store-zip.sh README.md
# optional: add vercel-api if you deploy from this repo
# git add vercel-api/
git add PREP_FOR_ZIP_AND_GITHUB.md
git status
git commit -m "v1.0.23: entity sources, settings overlay, search placeholder, release prep"
git push -u origin main
```

---

## 3. `.gitignore` (already updated)

- Store zips: `nimbus-*-store.zip`, `Nimbus-*.zip`, `*-extension-submission.zip`
- Secrets: `.env`, `.env.*`, `.env.local`
- Junk: `zimAfVIV`
- Existing: `node_modules/`, `*.log`, `.DS_Store`, etc.

---

## 4. If `git push` fails

- **Auth**: use a [Personal Access Token](https://github.com/settings/tokens) or `gh auth login`.
- **Remote**: `git remote -v` should show your GitHub repo; if not, `git remote add origin https://github.com/YOUR_USER/Nimbus.git`.

---

## 5. After pushing

- Upload `nimbus-v*.*-store.zip` in [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) when you’re ready to publish.
