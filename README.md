# CursorIQ Chrome Extension

A Chrome extension that provides instant word explanations when you hover over any word for 3 seconds. Features include Google search integration and clickable synonym tags.

## Features

- **Hover to Explain**: Hover over any word for 3 seconds to get a plain-English explanation
- **Google Search Button**: Click to search the word on Google
- **Scrollable Synonyms**: View and click synonyms at the bottom of the tooltip
- **Mini Windows**: Click synonyms to open mini explanation windows
- **Freemium Model**: Free tier with daily limits, upgrade to Pro for unlimited usage

## Installation for Development

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked" and select the `CursorIQ` folder
4. Click "Details" → "Extension options" and paste your OpenAI API key
5. Visit any webpage and hover over a word for 3 seconds

## Setup

1. **Get an OpenAI API Key**: Sign up at [OpenAI](https://platform.openai.com/) and create an API key
2. **Configure the Extension**: 
   - Right-click the extension icon → Options
   - Paste your OpenAI API key
   - Choose your preferred explanation style
   - Set daily free explanation limit
3. **Start Using**: Hover over any word on any webpage for 3 seconds

## How It Works

1. **Hover Detection**: The extension detects when you hover over a word for 3 seconds
2. **Word Highlighting**: The word is briefly highlighted
3. **AI Explanation**: The extension sends the word and context to OpenAI for explanation
4. **Tooltip Display**: A tooltip appears with:
   - The explanation
   - A Google search button
   - Scrollable synonym tags
5. **Synonym Interaction**: Click any synonym to open a mini window with its explanation

## File Structure

```
CursorIQ/
  assets/
    icon16.png
    icon48.png
    icon128.png
  manifest.json
  background.js
  contentScript.js
  tooltip.css
  options.html
  options.js
  README.md
```

## Configuration

### Options Page Settings

- **OpenAI API Key**: Required for generating explanations
- **Explanation Style**: 
  - Plain (everyday language)
  - Technical (developer-focused)
  - Explain like I'm 12
- **Daily Free Explanations**: Set limit for free tier (default: 20)
- **Pro License**: Unlock unlimited usage

## Privacy

- OpenAI API key is stored locally in your browser
- Only the selected word and limited page context are sent to OpenAI
- No browsing history or personal data is collected
- No data is sold to third parties

## Publishing to Chrome Web Store

1. Create developer account at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee)
2. Prepare assets:
   - 128×128 icon
   - 1280×800 hero screenshot
   - Additional screenshots (440×280)
3. ZIP the extension folder (manifest.json at root)
4. Upload ZIP and fill out listing
5. Submit for review

## Future Improvements

- Cache explanations to reduce API calls
- Right-click context menu for manual explanations
- Server-side license validation
- Multi-language support
- Better DOM handling for complex pages

## License

This extension uses OpenAI's API for generating explanations. You are responsible for your own API usage and costs.


