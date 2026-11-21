# Release checklist — Production V2 Export + Security plan A

**Nothing here has been done in Production.** Every step needs the owner's approval.
Status kept: A1 = HIGH · G2 = NOT APPROVED · Quality Dashboard Production = NO-GO.

## 0. Before anything (all must be true)
- [ ] **PR #5 (Export) owner checks:** design review · Microsoft Excel desktop opens a sample · release window.
      (Date-field check: read-only COUNT on 2026-11-20 = PASS, 0 documents without a usable date.)
- [ ] **Quality Dashboard deploy source decided** (see §2, step 3). The QD branch is 88 commits ahead of QD `main`; `release/qd-v5-limited` is local only and has **no** `pv2-access.js`.
- [ ] **G1 done** (§3).
- [ ] Rules file to publish = `production-v2/security/firestore.rules.candidate` (sha256 `c7139587…cb06`). Not QD's `emulator/firestore.rules` or the bridge: those are for the later QD sign-in rollout and already carry the same PV2 block.

## 1. Merge order (nothing merged yet)
1. **PR #5 first**, with **Create a merge commit** (not squash).
2. Then open the Security PR from `security-login-v1`: it shows only its own commit (`d157fbe`).
   Trial merges in both orders are conflict-free; this order keeps each approval separate.
   A squash merge of PR #5 would make the Security PR re-add the same 6 commits and conflict.
3. Security first is possible but not advised: it ships Export without its own approval and leaves PR #5 empty.

## 2. Deploy order (the code works with the OLD and the NEW rules, so deploy code first)
| # | Step | Smoke test straight after |
|---|---|---|
| 1 | **Accounts and role documents** (§4) | a viewer signs in on Production V2 |
| 2 | **Production V2 code:** merge PR #5, then the Security PR (GitHub Pages, about 1 minute) | login bar on every page; viewer sees data; editor saves as before |
| 3 | **Quality Dashboard code with `js/pv2-access.js`** (from the branch that contains it) | login bar on Dashboard / Scrap Entry; after sign-in the same numbers; Scrap Entry model list loads |
| 4 | **Re-check G1** | hash matches |
| 5 | **Publish `firestore.rules.candidate`** in a quiet period. Propagation can take up to about a minute (not verified here) | §5 |
| 6 | Watch Usage for the first day | Dashboard / Executive Summary use about 2× reads |

**Never publish the rules before step 3:** the live Quality Dashboard reads production data without signing in and would show no numbers.

## 3. G1: confirm the live rules before publishing
1. Firebase Console → Firestore Database → **Rules** → select all, copy, save as `live-rules.txt` (UTF-8).
2. `sha256sum live-rules.txt` (Windows: `certutil -hashfile live-rules.txt SHA256`)
   must equal `0967944bcf8bbe6f2051004424bd5819fd656018165b1aaca9982f13e3a22e2f` (3,908 bytes).
3. If only line endings differ: `tr -d '\r' < live-rules.txt | sha256sum`.
4. **If it still differs: stop.** Send the file; the candidate is rebuilt from the new text with `build-candidate.js` and the rules tests are re-run. Also note the database (expected `(default)`) and the last-published time.

## 4. Accounts
- Existing employees: nothing to do. Their allowlist documents have no `role`, which means **editor**.
- Add `prodV2_authorizedUsers/<code>@prodv2.local` (lowercase) with `{ active: true, role: "viewer" }` for: factory display accounts, **every Scrap Entry recorder**, every QD user who must see production numbers (a QD role alone grants nothing in Production V2).
- Create the matching Authentication user `<code>@prodv2.local` where missing. Use one shared-PC account per area (viewer), not personal editor accounts.
- Remove access: set `active: false` (or delete the document) and disable the Authentication user.
- Check that no existing document is `active: false` by accident (it would lose write access).
- Optional: Authentication → Settings → disable self sign-up (the rules already need a role document).

## 5. Smoke test after publishing
1. **Private window, signed out:** every Production V2 page and the QD Dashboard / Executive Report / Scrap Entry show only the sign-in bar, no production numbers.
2. **Direct read check** (signed out): a `runAggregationQuery` COUNT on `prodV2_actualLogs`, and a list of `prodV2_authorizedUsers`, return **PERMISSION_DENIED (403)**.
3. **Viewer:** same figures as before; Entry / Plan / Loss show read-only and a save is refused.
4. **Editor:** a normal entry saves.
5. **Export Excel** as viewer and as editor: downloads, totals equal Production Entry.
6. **Quality Dashboard:** recorder signs in → model list loads → a scrap record saves (QD rights unchanged); KPI, charts and tables as before.
7. **Legacy site** (`index.html` at the repository root): still works with no sign-in.
8. **Sign out** button on a desktop and a phone (note: Scrap Entry on tablet / phone, see §7).

## 6. Rollback (the code works with both rule sets, so rules can be rolled back alone)
- **Rules:** Console → Rules → history → re-publish the version that was live before, or paste `production.firestore.rules.snapshot` → Publish.
- **Code:** `git revert -m 1 <merge-sha>` for the Security merge (then PR #5's merge if needed); Pages republishes.
- **Accounts / documents:** leave them; they are harmless under the old rules.
- **Triggers:** legitimate users get permission errors → first check their role document; widespread → roll back the rules.

## 7. Open items
- **Pre-existing, not caused by this work:** on `scrap-entry.html` at 1023 px and below, two ☰ buttons share one id and the top one is not wired, so the menu (and the sign-out button inside it) cannot be opened with a tap. Same on the code before this work. Fix = remove one duplicated button and overlay pair in `scrap-entry.html` (needs approval: it changes Scrap Entry beyond the permission check).
- Quality Dashboard collections `scrapLogs`, `targetMaster`, `improvements`, `scrapModelMappings` and `productionLogs` stay publicly writable (unchanged; separate decision).
- QD e2e and rules tests were adapted to the new sign-in, with no check removed (QD reports in the QD repo).
