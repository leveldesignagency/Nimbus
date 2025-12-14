# Debug Steps - If Extension Not Working

## Step 1: Reload Extension
1. Go to `chrome://extensions`
2. Find "CursorIQ"
3. Click the **reload icon** (circular arrow)
4. Make sure it's **enabled** (toggle should be blue/on)

## Step 2: Open Console
1. Go to any webpage (Wikipedia, Google, etc.)
2. Press **F12** to open Developer Tools
3. Click the **Console** tab

## Step 3: Check for Messages
You should see:
- `CursorIQ: Content script loaded on [url]`

If you DON'T see this:
- The extension isn't loading
- Try reloading the extension again
- Check for red errors in console

## Step 4: Test Hover
1. Hover over any word on the page
2. Keep mouse **completely still** for 3 seconds
3. Watch the console for messages:
   - `CursorIQ: Debug - Found word: [word]` (every 100 mouse moves)
   - `CursorIQ: Triggering explain for word: [word]` (after 3 seconds)
   - `CursorIQ Background: Received explain request for: [word]`
   - `CursorIQ: Using free dictionary API for: [word]`

## Step 5: Check for Errors
Look for red error messages in console:
- If you see errors, copy them and check what they say
- Common issues:
  - "Cannot read property..." = JavaScript error
  - "Failed to fetch" = Network/API error
  - "Extension context invalidated" = Need to reload extension

## Step 6: Test on Simple Page
Try on a very simple page like:
- `https://example.com`
- A plain text page
- Avoid complex sites with lots of JavaScript

## Step 7: Check Extension Permissions
1. Go to `chrome://extensions`
2. Click "Details" under CursorIQ
3. Make sure permissions include:
   - "Read and change data on websites you visit"
   - "Access your data on api.dictionaryapi.dev"

## If Still Not Working:
1. **Copy all console messages** (especially errors)
2. **Try a different browser** (or Chrome profile)
3. **Disable other extensions** temporarily
4. **Check if it works in incognito mode**

The extension should work now with the simplified code!


