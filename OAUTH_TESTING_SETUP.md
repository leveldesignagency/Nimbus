# How to Test OAuth in Unpacked Mode

## The Problem
OAuth client IDs in `manifest.json` are tied to a specific extension ID. Unpacked extensions have a different ID than published ones, so you need separate OAuth clients.

## Solution: Create Test OAuth Client

### Step 1: Get Your Unpacked Extension ID

1. Load your extension as unpacked in Chrome
2. Go to `chrome://extensions/`
3. Find "Nimbus" extension
4. **Copy the Extension ID** (looks like: `abcdefghijklmnopqrstuvwxyz123456`)

### Step 2: Create Test OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (nimbus-extension)
3. Go to **APIs & Services** → **Credentials**
4. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
5. Configure:
   - **Application type**: Chrome App
   - **Name**: "Nimbus Extension (Test/Unpacked)"
   - **Application ID**: [PASTE YOUR UNPACKED EXTENSION ID HERE]
6. Click **"Create"**
7. **Copy the Client ID** (looks like: `123456789-abc.apps.googleusercontent.com`)

### Step 3: Add to Manifest for Testing

Add the test OAuth client ID to `manifest.json`:

```json
"oauth2": {
  "client_id": "YOUR_TEST_CLIENT_ID_HERE.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

### Step 4: Test

1. Reload the extension
2. Click "Sign in with Google"
3. OAuth popup should open and work!

## For Production

When ready to publish:
1. Use the **published extension ID**: `abmihilkdbamlelkmpfegjfimcjpcihh`
2. Use the **production OAuth client ID**: `910760921542-kn4l16sg0b25egp8aitr9rt23gmc4fdr.apps.googleusercontent.com`
3. Add it back to manifest before creating the zip

## Quick Reference

- **Unpacked Extension ID**: Get from `chrome://extensions/` (changes each time you reload)
- **Published Extension ID**: `abmihilkdbamlelkmpfegjfimcjpcihh` (fixed)
- **Test OAuth Client**: Create new one for unpacked ID
- **Production OAuth Client**: `910760921542-kn4l16sg0b25egp8aitr9rt23gmc4fdr.apps.googleusercontent.com`



