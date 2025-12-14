# How to Submit Nimbus to Chrome Web Store

## Step-by-Step Guide

### Step 1: Create Developer Account

1. **Go to Chrome Web Store Developer Dashboard:**
   - Open Chrome browser
   - Visit: https://chrome.google.com/webstore/devconsole
   - Or search: "Chrome Web Store Developer Dashboard"

2. **Sign In:**
   - Click "Sign in" (top right)
   - Use your Google account
   - If you don't have one, create it at accounts.google.com

3. **Pay Registration Fee:**
   - Click "Pay Registration Fee" or "Get Started"
   - Pay **$5 one-time fee** (not recurring)
   - You can use credit/debit card or PayPal
   - This is a one-time payment for lifetime access

4. **Complete Setup:**
   - Accept terms and conditions
   - Complete your developer profile
   - Verify your account (if required)

---

### Step 2: Upload Your Extension

1. **In the Developer Dashboard:**
   - Click the **"New Item"** button (usually top right or center)
   - Or look for **"Add new item"** or **"Upload"**

2. **Upload the ZIP file:**
   - Click **"Choose File"** or drag and drop
   - Select: `nimbus-extension.zip`
   - Location: `/Users/charlesmorgan/Documents/CursorIQ/nimbus-extension.zip`
   - Click **"Upload"**

3. **Wait for Processing:**
   - Chrome will validate your extension
   - This may take 1-2 minutes
   - You'll see a progress bar

---

### Step 3: Fill Out Store Listing

After upload completes, you'll see a form with these sections:

#### Basic Information:
- **Name:** `Nimbus`
- **Summary (Short Description):** 
  ```
  Select any word for instant definitions, synonyms, and examples. Highlightenment at the click of a button
  ```

#### Detailed Description:
Copy from `FINAL_SUBMISSION_CHECKLIST.md` (the long description)

#### Category:
- Select: **Productivity** (recommended)
- Or: **Education**

#### Language:
- Select: **English (United States)**

#### Privacy Policy:
- URL: `https://leveldesignagency.github.io/Nimbus/`

#### Images:
- **Screenshots:** Upload your 2 screenshots
  - Click "Add screenshot"
  - Upload each one
- **Promotional Tile:** Upload `Nimbus_Promo_Image.png`
  - Click "Add promotional image"
  - Upload the PNG file

#### Icon:
- Should auto-detect from your package (icon128.png)
- If not, upload `assets/icon128.png`

#### Content Rating:
Answer these questions:
- **Does your extension collect user data?** → **No** (all data is local)
- **Does it interact with third-party services?** → **Yes** (dictionary API, optional OpenAI)
- **Does it contain user-generated content?** → **No**

---

### Step 4: Review & Submit

1. **Review Everything:**
   - Check all fields are filled
   - Verify privacy policy URL works
   - Make sure screenshots look good
   - Check promotional image displays correctly

2. **Submit for Review:**
   - Click **"Submit for Review"** button (usually at bottom)
   - Confirm submission
   - You'll see a confirmation message

3. **Wait for Review:**
   - Review typically takes **1-3 business days**
   - You'll get an email when it's approved or if changes are needed
   - Check dashboard for status updates

---

## 📋 Quick Checklist

Before submitting, make sure you have:
- [ ] Developer account created ($5 paid)
- [ ] `nimbus-extension.zip` ready
- [ ] 2 screenshots ready
- [ ] `Nimbus_Promo_Image.png` ready
- [ ] Privacy policy URL: https://leveldesignagency.github.io/Nimbus/
- [ ] Store listing content copied (from FINAL_SUBMISSION_CHECKLIST.md)

---

## 🆘 Troubleshooting

**Can't find "New Item" button?**
- Make sure you're logged in
- Check you've paid the $5 fee
- Try refreshing the page

**Upload fails?**
- Check zip file isn't corrupted
- Make sure manifest.json is at root
- File size should be under 10MB (yours is 147KB ✅)

**Privacy policy URL not working?**
- Visit https://leveldesignagency.github.io/Nimbus/ in browser
- Should show your privacy policy page
- If not, check GitHub Pages is enabled

---

## ✅ You're Ready!

Start with Step 1: Go to https://chrome.google.com/webstore/devconsole

Let me know if you hit any issues during the process!


