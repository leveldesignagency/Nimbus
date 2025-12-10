# GitHub Pages Setup for Privacy Policy

## Quick Setup Steps

### Step 1: Push Files to GitHub

1. **Initialize git repository** (if not already done):
   ```bash
   cd /Users/charlesmorgan/Documents/CursorIQ
   git init
   git add .
   git commit -m "Initial commit - Nimbus extension"
   ```

2. **Add your GitHub repository**:
   ```bash
   git remote add origin https://github.com/leveldesignagency/Nimbus.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Enable GitHub Pages

1. Go to your repository: https://github.com/leveldesignagency/Nimbus
2. Click **Settings** (top menu)
3. Scroll down to **Pages** (left sidebar)
4. Under **Source**, select:
   - **Branch**: `main`
   - **Folder**: `/ (root)`
5. Click **Save**

### Step 3: Get Your Privacy Policy URL

After enabling GitHub Pages, your privacy policy will be available at:
```
https://leveldesignagency.github.io/Nimbus/
```

**Note**: It may take a few minutes for GitHub Pages to deploy.

### Step 4: Verify It Works

1. Wait 2-5 minutes after enabling Pages
2. Visit: https://leveldesignagency.github.io/Nimbus/
3. You should see the privacy policy page

---

## Alternative: Use a Subfolder (Recommended)

If you want to keep the extension code separate from the privacy policy:

1. Create a `docs` folder
2. Move `index.html` to `docs/index.html`
3. In GitHub Pages settings, select:
   - **Branch**: `main`
   - **Folder**: `/docs`
4. URL will be: `https://leveldesignagency.github.io/Nimbus/`

---

## Next Steps After Privacy Policy is Live

Once you have the URL, we'll add it to `manifest.json`:

```json
"privacy_policy": "https://leveldesignagency.github.io/Nimbus/"
```

Then you're ready for Step 3!

