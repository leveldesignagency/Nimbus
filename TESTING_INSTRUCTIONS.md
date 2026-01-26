# Testing Instructions - Load Unpacked

## ✅ Development Mode Bypass Enabled

The extension automatically detects when it's loaded as "unpacked" and **bypasses all subscription checks** for testing.

## How to Test Payment Flow

### Step 1: Load Extension as Unpacked

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in top right)
4. Click **"Load unpacked"**
5. Select the `CursorIQ` folder (or the `nimbus-store-package` folder)

### Step 2: Test Without Payment (Development Mode)

When loaded as unpacked:
- ✅ **All features work immediately** - no payment required
- ✅ Extension bypasses subscription check automatically
- ✅ You can test all functionality

**Console will show:** `"Nimbus: Development mode detected - bypassing subscription check"`

### Step 3: Test Payment Flow (Optional)

To test the actual payment flow:

1. **Temporarily disable development bypass:**
   - In `popup.js` line 41, change:
     ```javascript
     const isDevelopmentMode = !chrome.runtime.getManifest().update_url;
     ```
   - To:
     ```javascript
     const isDevelopmentMode = false; // Force production mode for testing
     ```

2. **Test the payment:**
   - Open extension popup
   - Should show payment form
   - Sign in with Google
   - Use test card: `4242 4242 4242 4242`
   - Complete payment
   - Extension should unlock

3. **Re-enable development bypass** after testing

## What Gets Bypassed in Development Mode

- ✅ Subscription check in `popup.js`
- ✅ Subscription check in `contentScript.js`
- ✅ All word lookups work
- ✅ All features unlocked

## Testing Checklist

- [ ] Load extension as unpacked
- [ ] Verify console shows "Development mode detected"
- [ ] Test word selection on any webpage
- [ ] Test extension popup/hub
- [ ] Test AI chat features
- [ ] All features should work without payment

## Notes

- **Development mode = Unpacked extension** (no `update_url` in manifest)
- **Production mode = Installed from Chrome Web Store** (has `update_url`)
- The bypass is automatic - no manual configuration needed

