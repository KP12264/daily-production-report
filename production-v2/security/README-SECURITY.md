# Production V2 — Security plan A (test branch `security-login-v1`)

**Status:**
- Emulator-tested only.
- **Nothing is published or deployed.**
- The live Firestore Rules are unchanged.

## What changes
| Before | After |
|---|---|
| Dashboard, Executive Summary and Assembly are readable without login. Other pages show data read-only without login. | **Every Production V2 page asks for a login before it reads any data.** |
| Anyone can read every `prodV2_*` document and list `prodV2_authorizedUsers` (employee e-mails). | Reading needs a signed-in account with a **role**. The allowlist can only be read one document at a time, by its owner, and cannot be listed. |
| Write access = signed in + allowlist document exists. | Write access = role `editor` (or no role field: the existing documents stay editors). |

### Roles: `prodV2_authorizedUsers/{code}@prodv2.local` (edited in the Firebase Console, as today)
| Document | Access |
|---|---|
| none, or `active: false` | no access: the page shows "no access" |
| `role: "viewer"` | read every page, Export Excel; no saving (write controls greyed, Rules refuse writes) |
| `role: "editor"` or **no `role` field** | read + write, exactly as today |

## Files
| File | Change |
|---|---|
| `js/auth-v2.js` | adds `requireAccess`, `whenAccess` and `roleOf`. Pages read data only after login, plus one read of the user's own allowlist document. Logout reloads the page. `mountGate` is kept. |
| `index.html`, `exec.html`, `assembly.html` | load Firebase Auth + `auth-v2.js` and add an empty login host. While locked, the content after it is hidden (no new wrapper or CSS). |
| `entry`, `plan`, `loss`, `order`, `master`, `cabinet-coverage`, `cabinet-import` (`.html` + `.js`) | `requireAccess` instead of `mountGate`. Data loading starts with `whenAccess(init)` instead of `DOMContentLoaded`. |
| `js/export.js` | role check (viewer or editor may export) |
| `security/production.firestore.rules.snapshot` | the rules the owner copied from the Firebase Console (sha256 `0967944b…`, recorded 2026-11-03) |
| `security/pv2-block.rules`, `security/build-candidate.js`, `security/firestore.rules.candidate` | the candidate is built from the snapshot by replacing **only** the Production V2 block. The script fails if any other byte differs. `--check` verifies the committed file. |

`production-v2/firestore.rules` is **not** the deployed version: it lacks the Quality Dashboard blocks. Never publish it.

## Firestore reads
Measured on the emulator with the synthetic fixture.
- **After** = viewer + candidate rules.
- **"rule reads"** = one dependent read per request: the rules `get()` the user's own allowlist document, cached within a request. For queries this is once per query, not per document.

| Scenario | Before | After: documents | After: rule reads | After: billed |
|---|---|---|---|---|
| Dashboard, day | 16 | 17 | 12 | 29 |
| Dashboard, week (7 days) | 237 | 237 | 231 | 468 |
| Dashboard, 30-day range | 686 | 686 | 682 | 1,368 |
| Executive Summary | 141 | 142 | 137 | 279 |
| Entry / Plan / Order / Master | 5 | 6 | 1 | 7 |
| Loss | 7 | 8 | 3 | 11 |
| Export, daily / weekly / monthly | 13 / 81 / 146 | 13 / 81 / 146 | +3 each | 16 / 84 / 149 |

- **Per page load:** +1 read for the user's own allowlist document.
- **Pages that read many single documents** (Dashboard, Executive Summary) need **about 2×** reads with the candidate rules.
- **Export:** +3 per run.
- **To avoid the 2× cost** (owner decision): role as a Firebase Auth custom claim, which needs no rule reads but needs an Admin SDK script to assign roles; or Dashboard / Executive Summary range queries instead of per-unit reads (code change).

## Tests (emulator only, project `demo-quality-dashboard`, no production host reachable)
| Suite | Result |
|---|---|
| Rules matrix: 8 user types × 14 `prodV2_*` collections × get/list/create/update/delete; allowlist own/other/list/write; editors' writes identical to the deployed rules; non-PV2 collections identical to the deployed rules | 219/219 |
| Browser, 11 pages × anonymous / no role / inactive / viewer / editor / legacy editor, before vs after:<ul><li>login form and 0 reads when signed out</li><li>same page text</li><li>identical screenshots</li><li>session reload</li><li>logout</li><li>13 write paths</li><li>Export viewer / editor / inactive</li></ul> | 123/123 |
| Export suites (core / workbook / layout / page / date field) | 50 / 81 / 1398 / 32 / 5 |

## Not done here (needs owner approval)
- **Quality Dashboard** reads `prodV2_actualLogs` and `prodV2_dailyPlans` without login. With the candidate rules those reads are refused. Its sign-in module only works in its own "enforce" mode, so a change there is larger than planned and is on hold.
- **Before any publish:**
  - re-copy the live rules from the Console and compare the sha256 (G1);
  - create the viewer accounts and add `role` where needed;
  - deploy the code first (it works with both rule sets);
  - then publish the candidate;
  - rollback = publish the snapshot.
