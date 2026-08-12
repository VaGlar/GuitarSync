#!/usr/bin/env node
// Builds dist/ with a pinned "key" in manifest.json so the extension keeps the
// same Chrome extension ID (and therefore the same Spotify redirect URI)
// regardless of which machine or folder it's loaded from.
//
// The RSA key pair lives only in extension-key.pem, generated locally on first
// run and never committed (see .gitignore). Back that file up somewhere safe —
// losing it means the next build gets a brand new extension ID.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const KEY_PATH = path.join(ROOT_DIR, 'extension-key.pem');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SOURCE_FILES = ['manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js'];

function getOrCreatePrivateKey() {
  if (fs.existsSync(KEY_PATH)) {
    return crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
  }
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs1', format: 'pem' }));
  console.log(`Generated a new extension key at ${KEY_PATH}`);
  console.log('This file is gitignored — keep a personal backup, do not commit it.\n');
  return privateKey;
}

function publicKeyDer(privateKey) {
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
}

// Same algorithm Chrome uses: SHA-256 of the DER public key, first 16 bytes,
// each nibble mapped to a letter a-p.
function computeExtensionId(der) {
  const hashHex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return hashHex.replace(/[0-9a-f]/g, c => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)));
}

function build() {
  const privateKey = getOrCreatePrivateKey();
  const der = publicKeyDer(privateKey);
  const keyB64 = der.toString('base64');
  const extensionId = computeExtensionId(der);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  for (const file of SOURCE_FILES) {
    const srcPath = path.join(ROOT_DIR, file);
    const destPath = path.join(DIST_DIR, file);
    if (file === 'manifest.json') {
      const manifest = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
      manifest.key = keyB64;
      fs.writeFileSync(destPath, JSON.stringify(manifest, null, 2) + '\n');
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  console.log(`Built ${path.relative(ROOT_DIR, DIST_DIR)}/ with a pinned extension ID.\n`);
  console.log(`Extension ID:          ${extensionId}`);
  console.log(`Spotify redirect URI:  https://${extensionId}.chromiumapp.org/\n`);
  console.log('Load "dist/" (not the repo root) via chrome://extensions -> Load unpacked.');
  console.log('As long as extension-key.pem is present, this ID stays the same on any machine.');
}

build();
