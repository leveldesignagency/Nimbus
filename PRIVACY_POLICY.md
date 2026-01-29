# Nimbus Privacy Policy

**Last Updated:** January 27, 2026

## Overview

Nimbus ("we", "our", or "us") is a Chrome extension that provides definitions, translations, and AI explanations for words and phrases you select. This Privacy Policy explains what data we collect, how we use it, and how we protect it, in line with Chrome Web Store requirements.

## Chrome Extension Permissions & Why We Use Them

Our extension requests the following Chrome permissions. We use them only as described:

- **Storage**: To save your preferences (e.g. explanation style, optional API key), recent searches, favorites, subscription status, and saved items locally in your browser. We do not upload this data to our servers.
- **Identity**: To let you sign in with Google so we can access your email address only for subscription verification, checkout, and account recovery. We do not access any other Google account data.
- **Tabs**: To detect when you return from payment (Stripe) so we can confirm your subscription, and to open links (e.g. dictionary or Wikipedia) in a new tab. We do not collect, store, or track your browsing history or tab URLs.

## Information We Collect

### Data Stored Locally (on Your Device)

- **Word searches & favorites**: Words or phrases you select and mark as favorites, for recent searches and favorites
- **Settings**: Your preferences (e.g. explanation style, optional OpenAI API key) — stored only in your browser
- **Subscription**: Subscription ID, expiry date, and status (if you subscribe), and your email when you sign in — for premium features
- **Saved items**: Pages or snippets you choose to save, stored locally only

### Data Sent to Services (Only When You Use a Feature)

- **Selected text**: When you look up a word, translate, or request an explanation, we send only that selected text to the relevant service (dictionary, translation, or AI API). We do not send your browsing history.
- **Email**: If you sign in with Google and subscribe, we use your email to verify your subscription and process checkout. Payment details (e.g. card) are handled by Stripe; we do not store payment card information.

### Data We Do NOT Collect

- We do NOT collect or track your browsing history or tab URLs
- We do NOT use analytics, advertising, or tracking services
- We do NOT sell or share your data with third parties for marketing

## How We Use Your Data

- **Local storage**: Favorites, recent searches, settings, and subscription status stay on your device using Chrome's storage API.
- **Lookups & APIs**: When you use a feature, we send only the necessary data (e.g. the word or phrase you selected) to:
  - **Dictionary API** (dictionaryapi.dev) — definitions
  - **LibreTranslate / MyMemory** — translations
  - **Wikipedia / Wikidata / Google News** — entity and context info
  - **Nimbus API** (nimbus-api-ten.vercel.app) — AI explanations and subscription verification
  - **OpenAI** (if you add your own API key) — enhanced explanations; we do not store or see your API key
- **Incognito**: In incognito/private browsing we do not save any data locally.
- **Single purpose**: We collect and use only what is needed for the extension's described functionality (definitions, translations, explanations, subscriptions).

## Third-Party Services

- **Google Identity**: Sign-in and email for subscription verification. Only your email is used; we do not access other Google data.
- **Stripe**: Payment processing for subscriptions. Stripe handles payment details; we do not store card numbers or full payment data.
- **Nimbus API (Vercel)**: Our backend for AI requests and subscription checks. It may receive selected text and your email for verification.
- **Free Dictionary API, LibreTranslate, MyMemory, Wikipedia, Wikidata, Google News**: Receive only the word or text you look up when you use that feature.
- **OpenAI**: If you provide your own API key, selected text may be sent to OpenAI via our API. We do not store or have access to your key.

## Data Security

- Data is stored locally in your browser; we do not transmit your browsing history.
- All connections to our API and third-party services use HTTPS.
- API keys you enter are stored locally and protected by Chrome's storage.

## Your Rights

- Remove the extension to clear all local data.
- Manage favorites and recent searches in the extension; sign out in Settings to clear account/subscription data.
- Disable or uninstall the extension at any time.

## Changes to This Policy

We may update this Privacy Policy. We will change the "Last Updated" date when we do. Continued use of the extension after changes means you accept the updated policy.

## Contact Us

Questions? Contact us via the [Nimbus GitHub repository](https://github.com/leveldesignagency/Nimbus).
