// Builds firestore.rules.candidate from the deployed-rules snapshot (copied from the Firebase Console)
// by replacing ONLY the Production V2 block. Fails unless every other byte is unchanged.
// Usage: node production-v2/security/build-candidate.js        (writes the candidate)
//        node production-v2/security/build-candidate.js --check (verifies the committed candidate)
// Nothing here publishes rules. The candidate is for the Firebase Emulator only.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = __dirname;
const SNAPSHOT = path.join(DIR, 'production.firestore.rules.snapshot');
const SNAPSHOT_SHA256 = '0967944bcf8bbe6f2051004424bd5819fd656018165b1aaca9982f13e3a22e2f';   // as recorded by the owner
const BLOCK = path.join(DIR, 'pv2-block.rules'), OUT = path.join(DIR, 'firestore.rules.candidate');
const START = '    // ── Production V2 — Dashboard must be viewable by anyone with no login,\n';
const END = '    // ── Quality Dashboard (separate app: scrap tracking, targets,\n';

const snap = fs.readFileSync(SNAPSHOT, 'utf8');
const sha = crypto.createHash('sha256').update(snap).digest('hex');
if (sha !== SNAPSHOT_SHA256) throw new Error(`snapshot sha256 ${sha} != recorded ${SNAPSHOT_SHA256}`);
const a = snap.indexOf(START), b = snap.indexOf(END);
if (a < 0 || b < 0 || b < a || snap.indexOf(START, a + 1) >= 0 || snap.indexOf(END, b + 1) >= 0) throw new Error('PV2 block markers not found exactly once');
const block = fs.readFileSync(BLOCK, 'utf8');
const banner = '// FIRESTORE RULES CANDIDATE — FOR THE FIREBASE EMULATOR ONLY. DO NOT PUBLISH WITHOUT OWNER APPROVAL.\n'
  + `// Built by production-v2/security/build-candidate.js from production.firestore.rules.snapshot (sha256 ${SNAPSHOT_SHA256})\n`
  + '// with only the Production V2 block replaced (pv2-block.rules). Every other line is the snapshot, unchanged.\n';
const out = banner + snap.slice(0, a) + block + snap.slice(b);
// guard: removing the banner and the new block gives back the snapshot minus its old PV2 block
const rest = out.slice(banner.length);
if (rest.slice(0, a) !== snap.slice(0, a) || rest.slice(a + block.length) !== snap.slice(b)) throw new Error('non-PV2 text changed');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(OUT, 'utf8') !== out) throw new Error('committed candidate is out of date: run build-candidate.js');
  console.log('candidate OK (non-PV2 text identical to the snapshot)');
} else { fs.writeFileSync(OUT, out); console.log('wrote', path.relative(process.cwd(), OUT), crypto.createHash('sha256').update(out).digest('hex')); }
