#!/usr/bin/env node
// One command to pick up new changes: git pull + rebuild dist/.
// Chrome still needs a manual reload afterwards (chrome://extensions -> the
// reload icon on the GuitarSync card) — Chrome only re-reads an unpacked
// extension's files when you tell it to, there's no way around that without
// publishing to the Chrome Web Store.

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: ROOT_DIR, stdio: 'inherit' });
}

run('git', ['pull']);
run('node', [path.join(__dirname, 'build.js')]);

console.log('\nDone. Now go to chrome://extensions/ and click the reload icon on the GuitarSync card.');
