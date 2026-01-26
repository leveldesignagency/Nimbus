# Testing Nimbus Extension on Microsoft Edge

## Compatibility Check ✅

Your extension uses standard Chromium APIs that are fully supported in Edge:
- ✅ `chrome.storage.local` - Supported
- ✅ `chrome.runtime` - Supported  
- ✅ `chrome.tabs` - Supported
- ✅ `chrome.identity` - Supported
- ✅ Manifest V3 - Supported
- ✅ Content Scripts - Supported
- ✅ Service Workers - Supported

**Expected Result:** Extension should work identically in Edge as it does in Chrome.

## Step-by-Step Testing Instructions

### 1. Load Extension in Edge

1. Open **Microsoft Edge**
2. Navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in bottom-left)
4. Click **Load unpacked**
5. Select your `CursorIQ` folder (the one containing `manifest.json`)

### 2. Verify Extension Loaded

- You should see "Nimbus" in the extensions list
- Check for any red error messages
- Extension icon should appear in Edge toolbar

### 3. Test Core Features

#### Test 1: Text Selection & Tooltip
1. Go to any webpage (e.g., Wikipedia)
2. **Select a word** (1-2 words)
3. Icon modal should appear
4. Click the AI icon to search
5. Popup should open with word details

#### Test 2: AI Chat
1. In the popup, verify AI chat loads
2. Type a question or select new text
3. AI should respond conversationally

#### Test 3: Text-to-Speech
1. Select text on a webpage
2. Click the sound icon in the icon modal
3. Voice should read the text smoothly

#### Test 4: Favorites & Recent Searches
1. Add a word to favorites (heart icon)
2. Check favorites section in popup
3. Verify recent searches appear

#### Test 5: News Articles
1. Search for a person, place, or organization
2. Scroll to news articles section
3. Click a news article link
4. Should open in new tab

### 4. Check for Edge-Specific Issues

Watch for:
- ❌ Console errors (F12 → Console tab)
- ❌ Permission prompts that don't appear in Chrome
- ❌ API calls failing (check Network tab)
- ❌ UI rendering issues
- ❌ Storage not persisting

### 5. Test on Different Sites

Try the extension on:
- Wikipedia
- News sites (BBC, CNN, etc.)
- Google search results
- Reddit
- Any text-heavy webpage

## Expected Behavior

Everything should work **exactly the same** as Chrome:
- ✅ Text selection detection
- ✅ Icon modal appearance
- ✅ AI chat functionality
- ✅ Text-to-speech
- ✅ Storage (favorites, conversations)
- ✅ News article links
- ✅ All UI interactions

## If Issues Occur

1. **Check Console** (F12 → Console)
   - Look for errors mentioning "chrome" or "runtime"
   - Note any Edge-specific error messages

2. **Check Permissions**
   - Go to `edge://extensions/`
   - Click "Details" under Nimbus
   - Verify all permissions are granted

3. **Compare with Chrome**
   - Test same feature in Chrome
   - Note any differences in behavior

4. **Report Issues**
   - Note the specific feature that fails
   - Copy console error messages
   - Note which website you're on

## Quick Test Checklist

- [ ] Extension loads without errors
- [ ] Text selection triggers icon modal
- [ ] AI icon opens popup with search
- [ ] AI chat responds to queries
- [ ] Text-to-speech works
- [ ] Favorites save correctly
- [ ] News articles are clickable
- [ ] Conversations save and load
- [ ] Extension icon in toolbar works
- [ ] No console errors

## Notes

- Edge uses the same extension architecture as Chrome
- Minor differences might exist in permission prompts
- Some Chrome-specific APIs might have Edge equivalents
- Overall, 99% compatibility is expected





