# Step 6: Package Extension & Submit to Chrome Web Store

## ✅ What You Have Ready:
- [x] Extension code (tested and working)
- [x] Privacy policy (live at https://leveldesignagency.github.io/Nimbus/)
- [x] Store listing descriptions (short + detailed)
- [x] Screenshots (2 ready)
- [x] Promotional image (Nimbus_Promo_Image.png)

---

## 📦 Step 6.1: Package Extension

### Option 1: Use the Script (Easiest)
```bash
cd /Users/charlesmorgan/Documents/CursorIQ
./prepare-for-store.sh
```

This creates: `nimbus-extension.zip`

### Option 2: Manual Package
1. Create a folder: `nimbus-store-package`
2. Copy these files:
   - manifest.json
   - background.js
   - contentScript.js
   - popup.html
   - popup.js
   - options.html
   - options.js
   - tooltip.css
   - assets/ (entire folder)
   - Nimbus Logo-02.svg (if needed)
   - Nimbus Favicon.png (if needed)
3. **DO NOT include:**
   - Debug files (DEBUG_STEPS.md, etc.)
   - .git folder
   - .DS_Store files
   - Screenshots
   - Documentation files
4. Zip the folder contents (not the folder itself)

---

## 🎯 Step 6.2: Verify Package

Before uploading, check:
- [ ] manifest.json is at root of zip
- [ ] All required files are included
- [ ] No debug/test files included
- [ ] Zip file size is reasonable (< 5MB)

---

## 💳 Step 6.3: Create Chrome Web Store Developer Account

1. Go to: https://chrome.google.com/webstore/devconsole
2. Sign in with your Google account
3. Pay **$5 one-time registration fee**
4. Complete developer account setup

**Note:** This is a one-time payment, not recurring.

---

## 📤 Step 6.4: Upload Extension

1. In Chrome Web Store Developer Dashboard:
   - Click **"New Item"**
   - Upload `nimbus-extension.zip`
   - Wait for upload to complete

---

## 📝 Step 6.5: Fill Out Store Listing

### Required Fields:

1. **Name:** Nimbus
2. **Summary (Short Description):**
   ```
   Select any word for instant definitions, synonyms, and examples. Highlightenment at the click of a button
   ```

3. **Description (Detailed):**
   ```
   [Copy from STEP_3_STORE_LISTING.md]
   ```

4. **Category:** Productivity (or Education)

5. **Language:** English (United States)

6. **Privacy Policy URL:**
   ```
   https://leveldesignagency.github.io/Nimbus/
   ```

7. **Screenshots:**
   - Upload your 2 screenshots (1280x800 or 640x400)

8. **Promotional Images:**
   - Upload `Nimbus_Promo_Image.png` (1280x800)

9. **Icon:**
   - Upload `assets/icon128.png` (already in package)

10. **Content Rating:**
    - Answer questions (all data is local, no user-generated content)

---

## ✅ Step 6.6: Submit for Review

1. Review all information
2. Click **"Submit for Review"**
3. Wait for review (usually 1-3 business days)

---

## 📋 Final Checklist Before Submission

- [ ] Extension packaged as .zip
- [ ] Privacy policy URL added to manifest.json
- [ ] All store listing content ready
- [ ] Screenshots ready (2)
- [ ] Promotional image ready
- [ ] Developer account created ($5 paid)
- [ ] Extension uploaded
- [ ] All fields filled out
- [ ] Ready to submit!

---

## 🚀 Let's Package It Now!

Run the packaging script, then we'll verify everything is ready for upload!


