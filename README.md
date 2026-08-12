# GuitarSync
A Chrome extension that detects what's playing on Spotify and automatically opens the best-rated chords or tabs — Ultimate Guitar for international songs, kithara.to for Greek artists. Supports auto mode, Chords/Tabs toggle, and Greeklish detection via Spotify genre metadata.

## Setup

1. `node scripts/build.js`
   - First run generates `extension-key.pem` locally (gitignored — back it up somewhere safe, it's never committed).
   - Prints the extension's fixed **Extension ID** and the **Spotify redirect URI** to register.
2. Chrome → `chrome://extensions/` → enable **Developer mode** → **Load unpacked** → select the `dist/` folder (not the repo root).
3. Spotify Developer Dashboard → your app → add the printed redirect URI (`https://<extension-id>.chromiumapp.org/`).
4. Click the extension icon, paste your Spotify **Client ID**, connect.

Re-running `node scripts/build.js` on any machine that has `extension-key.pem` reproduces the same Extension ID, so the Spotify redirect URI never needs to change. Without that file (e.g. a fresh clone), a new key/ID is generated on first run and the redirect URI must be updated accordingly.

## Getting updates

Chrome does not auto-update unpacked extensions — there's no way around that short of publishing to the Chrome Web Store. To pick up new changes:

```
node scripts/update.js
```

This pulls the latest code and rebuilds `dist/`. Then go to `chrome://extensions/` and click the reload icon (↻) on the GuitarSync card — that last step has to be done by hand in Chrome.
