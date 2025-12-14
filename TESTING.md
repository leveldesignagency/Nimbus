# Testing CursorIQ Extension

## Quick Start (No API Key Needed!)

The extension now works **without an OpenAI API key** using a free dictionary API!

## Steps to Test

1. **Load the Extension:**
   - Open Chrome → `chrome://extensions`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select the `CursorIQ` folder

2. **Check Console for Errors:**
   - Open any webpage (e.g., Wikipedia, news article)
   - Press F12 to open Developer Tools
   - Go to the "Console" tab
   - You should see: `CursorIQ: Content script loaded`
   - If you see errors, note them down

3. **Test Hover:**
   - Hover your mouse over any word on the page
   - **Keep the mouse still for 3 seconds** (don't move it!)
   - A tooltip should appear with the word's explanation
   - If nothing happens, check the console for errors

4. **Debug if Not Working:**
   - Open Console (F12)
   - Look for messages starting with "CursorIQ:"
   - Try hovering over different words
   - Make sure you're hovering over actual text (not images, buttons, etc.)

## Common Issues

### Issue: Nothing happens when hovering
**Solutions:**
- Make sure you hover for **exactly 3 seconds** without moving the mouse
- Check the browser console (F12) for errors
- Try reloading the page after loading the extension
- Make sure the extension is enabled in `chrome://extensions`

### Issue: "No response from background service"
**Solutions:**
- Check if the extension is enabled
- Reload the extension in `chrome://extensions` (click the reload icon)
- Check the console for errors

### Issue: Extension not loading
**Solutions:**
- Make sure all files are in the correct folder structure
- Check `chrome://extensions` for error messages (red text)
- Verify `manifest.json` is valid JSON

## Testing Features

1. **Hover Detection:** Hover over any word for 3 seconds
2. **Tooltip:** Should show explanation, Google button, and synonyms
3. **Google Button:** Click to open Google search
4. **Synonyms:** Scrollable tags at bottom - click to open mini window
5. **Mini Windows:** Click synonym tags to see their explanations

## Using OpenAI (Optional)

If you want to use OpenAI for better explanations:

1. Get an API key from https://platform.openai.com/
2. Open extension options (right-click extension icon → Options)
3. Paste your API key
4. Uncheck "Use free dictionary API" if you want OpenAI only
5. Save settings

The extension will automatically use OpenAI if a key is provided, otherwise it uses the free dictionary API.


