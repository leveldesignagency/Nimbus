# Fix Privacy Policy URL (Chrome Web Store)

Chrome says your privacy policy was **last listed at**:  
**https://leveldesignagency.github.io/Nimbus/**

That URL currently returns **404** because **GitHub Pages is not enabled** for the Nimbus repo.  
The file **index.html** (your privacy policy) is already in the repo at the root — it just isn’t being published.

---

## What to do (one-time)

1. Open: **https://github.com/leveldesignagency/Nimbus**
2. Click **Settings** (tab at the top).
3. In the left sidebar, click **Pages** (under “Code and automation”).
4. Under **“Build and deployment”**:
   - **Source:** choose **“Deploy from a branch”**.
   - **Branch:** choose **main** (or your default branch).
   - **Folder:** choose **/ (root)**.
5. Click **Save**.
6. Wait **2–5 minutes** for GitHub to build and deploy.
7. Open: **https://leveldesignagency.github.io/Nimbus/**  
   You should see your Nimbus privacy policy page.

---

## Manifest

Your **manifest.json** is set to:

```json
"privacy_policy": "https://leveldesignagency.github.io/Nimbus/"
```

So once GitHub Pages is enabled, the Chrome Web Store privacy link will work without changing the manifest again.

---

## If it still 404s

- Confirm **index.html** is at the **root** of the **main** branch:  
  https://github.com/leveldesignagency/Nimbus/blob/main/index.html  
- Give GitHub Pages a bit more time (up to ~10 minutes).
- In repo **Settings → Pages**, check that the branch is **main** and the folder is **/(root)**.
