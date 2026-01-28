# Nimbus Privacy Policy

**Last Updated:** January 27, 2026

## Overview
Nimbus ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our Chrome extension.

## Information We Collect

### Data Stored Locally
- **Word Searches**: Words you select are saved locally in your browser's storage for recent searches and favorites
- **Favorites**: Words you mark as favorites are stored locally
- **Settings**: Your preferences (API keys, explanation style) are stored locally in your browser
- **Subscription Status**: Subscription ID, expiry, and status (if you subscribe) are stored locally
- **Saved Items**: Pages or snippets you choose to save are stored locally

### Data We Do NOT Collect
- We do NOT collect your browsing history
- We do NOT use analytics or tracking services

## How We Use Your Data

- **Local Storage**: All data (favorites, recent searches, settings) is stored locally in your browser using Chrome's storage API
- **API Calls**: When you look up a word or request summaries, we may send the selected text to:
  - Free Dictionary API (dictionaryapi.dev) - for word definitions
  - Translation APIs (LibreTranslate and MyMemory) - for translations
  - Wikipedia/Wikidata/News APIs - for entity/context info
  - Nimbus API (nimbus-api-ten.vercel.app) - to proxy AI requests and subscription verification
  - OpenAI API (if you provide your own API key, via Nimbus API) - for enhanced explanations
- **Incognito Mode**: In incognito/private browsing mode, we do not save any data
- **Account/Subscription**: If you subscribe, we use your email address to verify your subscription status
- **Contact Form**: If you contact support, we use your name, email, and message to respond

## Third-Party Services

- **Free Dictionary API**: We use dictionaryapi.dev to fetch word definitions. This service receives the words you search for.
- **LibreTranslate / MyMemory**: Used for translations. These services receive the text you request to translate.
- **Wikipedia / Wikidata / Google News**: Used for definitions, background info, and related links. These services may receive the selected word or entity.
- **Nimbus API (Vercel)**: Used to proxy AI requests and verify subscriptions. It may receive the selected text and your email for subscription verification.
- **OpenAI API**: If you provide your own OpenAI API key, your selected text may be sent to OpenAI via Nimbus API. We do not store or have access to your API key.
- **Google Identity**: Used to access your email address for subscription verification and account recovery.

## Data Security

- All data is stored locally in your browser
- We do not transmit your browsing history to our servers
- API keys are stored locally and encrypted by Chrome's storage system

## Your Rights

- You can clear all data by removing the extension
- You can manage favorites and recent searches through the extension interface
- You can disable the extension at any time

## Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last Updated" date.

## Contact Us

If you have questions about this Privacy Policy, please contact us through the Nimbus GitHub repository: https://github.com/leveldesignagency/Nimbus.

---

**Note**: This privacy policy must be hosted online (GitHub Pages, your website, etc.) and the URL must be added to your manifest.json before Chrome Web Store submission.


