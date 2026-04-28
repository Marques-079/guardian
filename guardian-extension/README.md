# Guardian

A self-contained Chrome extension that uses Cerebras AI to gate your YouTube viewing.

- Blocks every URL under `https://www.youtube.com/shorts/`.
- Screens regular videos (`https://www.youtube.com/watch?v=...`) by sending the title to Cerebras. If the AI says ALLOW, you watch. If it says BLOCK, an overlay covers the page.
- When blocked you can open an **Argue** dialog and try to convince the AI in up to 5 messages. If you make a strong, specific case, it unblocks.
- Strict black & white minimal UI.

## Install

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this `guardian-extension/` folder.
4. Click the Guardian icon in the toolbar, then **Open settings**.
5. Paste your Cerebras API key (from https://cloud.cerebras.ai/) and **Save**.
6. Optional: hit **Test connection** to confirm the key works.

## Usage

- Visit any YouTube video. You will see a `SCREENING` overlay for ~1 second while Guardian asks Cerebras about the title.
- If the video is allowed, the overlay disappears and you watch normally.
- If blocked, you see the reason and two buttons:
  - **Leave page** sends you off YouTube.
  - **Argue your case** opens a chat where you have up to 5 messages to justify the video.
- Visit any Short → instantly blocked. You can argue Shorts too.
- Approved video IDs are remembered locally so you do not get re-screened. Clear them anytime from the popup or settings.

## Configuration

- **API key** — stored in `chrome.storage.local` only.
- **Model** — defaults to `llama3.3-70b`. You can swap to `llama3.1-8b` for faster/cheaper checks.
- **System prompts** — edit `SCREEN_SYSTEM_PROMPT` and `ARGUE_SYSTEM_PROMPT` in `background.js` to retune Guardian's strictness or your areas of interest.

## File layout

```
guardian-extension/
  manifest.json      Manifest V3 declaration
  background.js      Service worker — Cerebras API + storage
  content.js         YouTube SPA watcher + overlay logic
  content.css        Black & white overlay styles
  options.html/js/css  Settings page (API key, model, clear approvals)
  popup.html/js      Toolbar popup with quick controls
  icons/             16/48/128 PNG icons
```

## Notes

- Only the YouTube domain is read. The extension never touches other sites.
- The API key never leaves your machine except in direct requests to `api.cerebras.ai`.
- If the API call fails (no key, network error, rate limit), the overlay stays up with the error and the video is **not** auto-allowed — fail closed.
