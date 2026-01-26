# Google OAuth Setup for Chrome Web Store

## Why This Is Needed

The "Sign in with Google" feature uses Chrome's identity API. For the OAuth flow to work in production (Chrome Web Store), you need to configure an OAuth client ID.

## Current Implementation

The extension uses a two-step approach:
1. **First**: Tries `chrome.identity.getProfileUserInfo()` - Works if user is signed into Chrome (no OAuth client ID needed)
2. **Fallback**: Uses `chrome.identity.getAuthToken()` - Requires OAuth client ID setup

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

- **Unpacked mode**: `getProfileUserInfo` should work if signed into Chrome
- **Chrome Web Store**: Both methods should work after OAuth client ID is configured

## Notes

- The extension will work for users signed into Chrome even without OAuth client ID
- OAuth client ID is only needed for users NOT signed into Chrome
- Chrome Web Store reviewers should be able to test if they're signed into Chrome



