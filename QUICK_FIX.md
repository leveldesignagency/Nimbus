# Quick Fix Guide

## The Extension Now Works WITHOUT OpenAI Key!

I've added a **free dictionary API** so you can test immediately.

## To Test Right Now:

1. **Reload the extension:**
   - Go to `chrome://extensions`
   - Find "CursorIQ"
   - Click the reload icon (circular arrow)

2. **Open any webpage** (Wikipedia, news article, etc.)

3. **Open Developer Console:**
   - Press F12
   - Click "Console" tab
   - You should see: `CursorIQ: Content script loaded`

4. **Test hover:**
   - Hover over ANY word
   - **Keep mouse STILL for 3 seconds** (don't move!)
   - Tooltip should appear

## If Still Not Working:

Check the console for errors. Common issues:

1. **Extension not loaded:** Reload it in chrome://extensions
2. **Page needs refresh:** Refresh the page after loading extension
3. **Hovering too fast:** Must stay still for 3 full seconds
4. **Wrong element:** Hover over actual text, not images/buttons

## Debug Steps:

1. Open Console (F12)
2. Look for "CursorIQ:" messages
3. Try hovering over different words
4. Check if you see "Triggering explain for word: [word]" message

The extension should work now without any API key!
