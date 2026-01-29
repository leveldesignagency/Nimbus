# Push the Updated Privacy Policy So It Goes Live

The **live** page at https://leveldesignagency.github.io/Nimbus/ is still showing the **old** policy (no "Chrome Extension Permissions", no Stripe, "January 28" etc.). Your **CursorIQ project** has the **new** policy (Chrome-aligned) in commit `e6b0809`, but it may not be on GitHub yet.

## Do this from the CursorIQ project folder

1. **Open Terminal** and go to this project:
   ```bash
   cd /Users/charlesmorgan/Documents/CursorIQ
   ```

2. **See if you have commits that haven’t been pushed:**
   ```bash
   git status
   ```
   - If it says **"Your branch is ahead of 'origin/main' by 1 commit(s)"** (or more), your new policy commit isn’t on GitHub yet. Go to step 3.
   - If it says **"Your branch is up to date with 'origin/main'"**, go to step 4.

3. **Push the update:**
   ```bash
   git push origin main
   ```
   Wait for it to finish. Then wait **1–2 minutes** for GitHub Pages to rebuild.

4. **If you were already "up to date"** — then GitHub already has the commit, but Pages might be cached or built from something else:
   - On GitHub, open: **https://github.com/leveldesignagency/Nimbus/blob/main/index.html**
   - Search the file for **"Chrome Extension Permissions"**.
   - If you **don’t** see that text, the new policy never reached GitHub. Then run:
     ```bash
     git add index.html PRIVACY_POLICY.md vercel-api/public/privacy.html
     git commit -m "Privacy policy: align with Chrome requirements and permissions"
     git push origin main
     ```
   - If you **do** see it, GitHub has the new content. Reload the live page with a **hard refresh** (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows) or wait a few minutes and try again. You can also trigger a redeploy: repo **Settings → Pages → Save** (no need to change anything).

5. **Check the live page:**
   - Open: **https://leveldesignagency.github.io/Nimbus/**
   - You should see **"Chrome Extension Permissions & Why We Use Them"** and **"Last Updated: January 27, 2026"**. If not, hard-refresh or wait a bit and try again.

**Important:** Run these commands from **/Users/charlesmorgan/Documents/CursorIQ** (the folder where you have the updated `index.html`). If you use a different clone elsewhere, that clone might not have the new commit, and `git push` from there would show "Everything up-to-date" without updating the policy.
