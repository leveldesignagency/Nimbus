# Google OAuth Setup for Chrome Web Store

## Why This Is Needed

The "Sign in with Google" feature uses Chrome's identity API with **OAuth only**. The extension does **not** use the Chrome profile (e.g. `getProfileUserInfo`) to identify the user. That way:

- **First-time users** see "Sign in with Google" / "Sign up with Google" and must explicitly sign in.
- **Sign out** actually logs them out (no auto-fill from Chrome), and they see the sign-in screen again.
- **Account** is whoever signed in inside the extension, not tied to the Chrome profile.

You need an OAuth client ID for "Sign in with Google" to work in production (Chrome Web Store).

## Current Implementation

The extension uses **OAuth only** (`chrome.identity.getAuthToken({ interactive: true })`) when the user clicks "Sign in with Google". Stored `userEmail` comes only from that flow. Chrome profile is never used for identity.

## Setting Up OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable "Google+ API" or "Google Identity API"
4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
5. Choose "Chrome App" as application type
6. Enter your extension ID: `abmihilkdbamlelkmpfegjfimcjpcihh`
7. Copy the Client ID

## Configuring in Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Select your extension (Nimbus)
3. Go to "Store listing" or "Privacy" tab
4. Find "OAuth client ID" section
5. Paste the Client ID from step 7 above
6. Save changes

## Testing

- **Unpacked mode**: Use a Chrome App OAuth client ID for your unpacked extension ID (see OAUTH_TESTING_SETUP.md).
- **Chrome Web Store**: Use the production OAuth client ID for the published extension ID.

## Notes

- OAuth client ID is required for "Sign in with Google" to work (no Chrome-profile fallback).
- Sign out clears stored identity and revokes the cached token; the user must sign in again to use the app.



