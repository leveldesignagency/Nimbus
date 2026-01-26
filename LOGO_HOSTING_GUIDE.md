# Logo Hosting Fallback Guide

The extension now supports hosted logo fallbacks. If local logo files fail to load, the extension will automatically try to load the logo from hosted URLs.

## How It Works

1. **First**: Tries local logo files (`NimbusLogo.svg`, `Nimbus Logo-02.svg`, `Nimbus Logo-01.svg`)
2. **Then**: If all local files fail, tries hosted fallback URLs
3. **Finally**: If all fail, shows text fallback "Nimbus"

## Setting Up Hosted Logo

### Option 1: GitHub (Recommended - Free & Easy)

1. Upload `NimbusLogo.svg` to your GitHub repository
2. Get the raw file URL:
   - Go to your file on GitHub
   - Click "Raw" button
   - Copy the URL (looks like: `https://raw.githubusercontent.com/username/repo/main/NimbusLogo.svg`)
3. Update `popup.js` line ~1182:
   ```javascript
   const hostedFallbacks = [
     'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/NimbusLogo.svg',
     // Add more fallbacks here
   ];
   ```

### Option 2: Vercel Static Hosting

1. Create a `public` folder in your Vercel project
2. Upload `NimbusLogo.svg` to the `public` folder
3. Deploy to Vercel
4. Access at: `https://your-vercel-app.vercel.app/NimbusLogo.svg`
5. Update `popup.js` line ~1182:
   ```javascript
   const hostedFallbacks = [
     'https://your-vercel-app.vercel.app/NimbusLogo.svg',
   ];
   ```

### Option 3: jsDelivr CDN (via GitHub)

1. Upload logo to GitHub (same as Option 1)
2. Use jsDelivr CDN URL format:
   ```
   https://cdn.jsdelivr.net/gh/USERNAME/REPO@main/NimbusLogo.svg
   ```
3. Update `popup.js` line ~1182:
   ```javascript
   const hostedFallbacks = [
     'https://cdn.jsdelivr.net/gh/YOUR_USERNAME/YOUR_REPO@main/NimbusLogo.svg',
   ];
   ```

### Option 4: Your Own Domain/CDN

1. Upload `NimbusLogo.svg` to your web server or CDN
2. Get the direct URL to the file
3. Update `popup.js` line ~1182:
   ```javascript
   const hostedFallbacks = [
     'https://yourdomain.com/path/to/NimbusLogo.svg',
   ];
   ```

## Multiple Fallbacks

You can add multiple fallback URLs - the extension will try them in order:

```javascript
const hostedFallbacks = [
  'https://raw.githubusercontent.com/username/repo/main/NimbusLogo.svg',
  'https://your-vercel-app.vercel.app/NimbusLogo.svg',
  'https://cdn.jsdelivr.net/gh/username/repo@main/NimbusLogo.svg',
];
```

## Testing

1. Temporarily rename local logo files to test fallback
2. Open extension popup
3. Check browser console for logo loading messages
4. Should see: "All local logos failed, trying hosted fallback: [URL]"
5. Then: "✅ Logo loaded successfully from hosted URL: [URL]"

## Notes

- Hosted fallbacks only activate if ALL local files fail
- Each hosted URL has a 2-second timeout
- The extension will try all hosted URLs before showing text fallback
- No additional permissions needed - popup.html can load images from any URL





