# r9d handoff — crops/produce have no daily coin ceiling

This is a review draft. It was not merged, not published, and not applied to any live database. No player rows were read or changed.

## What changed

Crops and produce can be sold in any owned quantity. There is no daily coin ceiling on that sale. The ceiling is absent, not replaced by a large number.

Unchanged on purpose:

- Furniture buy-back stays 400 copper coins a day, half of the shop price, shop-bought units only.
- Task and merit earnings stay on the shared 40/day pool. Merit stays at 8/day inside that pool.
- Prices, inventory checks, request-id idempotence, the IndexedDB claim, the per-account pending key, and the save key `templeGarden.v1` are unchanged.
- No fortune stalls were added. Protected files were not edited: `audio.js`, `npc.js`, `realism.js`, `avatar.js`, `teahouse-assets.js`, `mounts.js`, `animals2.js`, `art3.js`, `suggest.js`.

## Baseline comparison (do not skip)

The attached archive was extracted only under `/tmp/crop-baseline-ref` and was not modified.

| Source | What it is | sha256 | size |
| --- | --- | --- | --- |
| Archive `v4/index.r9b.html` | Frozen r9b game, no backend splice | `559abfa1ca6b10d26b68a23cfdf9079f8a91e1347f6905c1737909e5773ce132` | 1,870,860 |
| Repo `index.html` at `a328f7c` (before this branch) | That same r9b game script, plus the live backend scripts | `4794ed293f5170c2a59c785f0a10974edbe166c434d9f933f7348abb137b75fd` | 2,343,325 |
| Archive `qa/r9c/src` | r9b sources plus the completed L1/L2/L3 buy-back fixes in `r9-sell.js` only | see snapshot of the pre-edit file in the r9c patch | — |

The game `<script>` in the repo page and in `v4/index.r9b.html` is the same 1,771,192 characters. The repo page is larger because it also inlines supabase, auth/storage/net, suggestions, wishes, garden, social, access, family, market, and `tg-r6.js`. Those extra scripts are not inside the frozen r9b file. `tg-r6.js` and `tg-market.js` in the repo page matched the archive byte for byte.

The repo game is therefore the frozen r9b pack. It does **not** contain the r9c L1/L2/L3 buy-back fixes. Those exist only in `qa/r9c/src/r9-sell.js` (version string `r9c`). This branch starts from that r9c file, not from the older sell code packed into `main`.

Every other packed source file in `qa/r9c/src` is present verbatim inside the frozen r9b HTML. `r9-sell.js` is the one packed file that is not, because the freeze was made before the L fixes.

## Client / server agreement

`econ_status` on the new draft returns:

- `sell_uncapped: true`
- `sell_cap: null`
- `sell_left: null`

`tg_limit('sell_coins')` returns SQL NULL. `econ_earn` for source `sell` grants the requested positive amount and does not call `tg_take_daily`. It does not write a sell-coin counter. One call must still be a positive integer no larger than 9,007,199,254,740,991 (the largest integer JavaScript can add safely). That is a per-call arithmetic bound, not a daily allowance.

Task, merit, and steal still use their existing caps. Furniture sell-back SQL is not replaced by this draft.

## Rollout and the old 100

Supported shapes:

1. **Legacy r9** (`sell_left` is a number, `sell_uncapped` is absent). The client uses that numeric cap. It does **not** fill a missing `sell_cap` with 100. If the server sends `sell_cap: 100`, the cap is 100, same as today.
2. **This draft** (`sell_uncapped: true`). No numeric crop ceiling, even if a stale `sell_left` is also present. The client remembers that for the rest of the page session.
3. **After that confirmation**, an offline error, a missing status, or another status that only carries `sell_left` / `sell_cap` does **not** put 100 back. A full reload reads the server again.
4. **Explicit recap** (`sell_uncapped: false` plus a numeric `sell_left`) leaves the uncapped session and applies that cap. The exact rollback draft does not send this flag; it restores the old function, so the cap returns on the next page load.
5. **Pre-r9 / no backend / offline before any uncapped confirmation** still shares the 40 pool with tasks and merit.

Fail-safe: the dangerous line was `Number(st.sell_cap) || 100`. That fallback is gone. A null cap is not turned into 100.

Old r9b/r9c pages do not understand `sell_uncapped`. If this SQL is applied while those pages are still open, `sell_left: null` makes them treat the server as pre-r9, and crop sales fall back onto the shared 40 until the player loads this client. Ship the client first. Apply the SQL only after this page is what players load.

`econ_earn` for crops is still not request-id idempotent. That was already true. Furniture buy-back keeps its request id, the ledger replay, the per-account pending record, and the IndexedDB claim.

## Files

- `qa/r9d-uncap/src/r9-sell.js` — game sale code (r9c L fixes kept, crop ceiling removed).
- `backend/tg-r6.js` — economy client. `TG_ECON.adoptSell` follows the same policy. Uncapped crop sales are not clamped to the mirrored 100 or to the 40 earn pool.
- `backend/r9d-uncap.sql` — forward draft.
- `backend/r9d-uncap-rollback.sql` — exact restore of `tg_limit`, `econ_earn`, and `econ_status` from r9.
- `v4/index.r9d.html` — frozen self-contained game (no backend splice), same shape as `index.r9b.html`.
- `index.html` — the site page. The r9b game script was replaced with the r9d pack. The r6 script was replaced with the new `tg-r6.js`. The other inlined backend scripts were not edited.
- `qa/r9d-uncap/r9-sell.patch`, `qa/r9d-uncap/tg-r6.patch` — diffs from the r9c / archive baselines.
- `qa/r9d-uncap/source-snapshot.tar.gz` — the `src` tree that was packed, plus the SQL drafts and `tg-r6.js`.
- `qa/r9d-uncap/SHA256SUMS.txt` — digests and sizes, including the unchanged protected files.

`X.debugState` / `X.debugPatch` are a test seam over the existing save. They do not change prices or caps.

## Checksums

Frozen game `v4/index.r9d.html`:

- sha256 `4ecd25c97847963860755de0e5caf279405b6d413c08adc277492ac3bd811520`
- 1,888,370 bytes

Site `index.html` on this branch:

- sha256 `1bef3f5f3a290d79d089bd7af8eb928d4abe44ced4cff5302d12c7ce33b15313`
- 2,362,729 bytes

Source snapshot `qa/r9d-uncap/source-snapshot.tar.gz`:

- sha256 `e60a221f92987687534a0f4e9cbde20188a716c8a7ef08a9afaa12bc033ef560`
- 803,780 bytes

## Tested

SQL, local PGlite only, with stub `auth.uid`, `tg_day`, `tg_daily_used`, and `tg_take_daily`. The production bodies of those helpers were not in the archive. 25/25 passed:

- Legacy function grants sell 100 and refuses the next coin when `p_exact` is true.
- After the forward draft, sell of 101, 5,000, 250,000, and 9,007,199,254,740,991 is granted in full, with `sell_uncapped: true` and null cap/left.
- Sell of 0, -5, and 9,007,199,254,740,992 is `bad_amount`.
- Those uncapped sells do not increase the `sell_coins` counter left by the old 100.
- Task still stops at 40. Merit still stops at 8 and still consumes the earn pool. Sell-back limit value stays 400.
- The exact rollback restores the 100 refusal.
- The forward draft does not replace `econ_sellback`, `market_buy`, or the family decor functions.

Browser, Chrome headless, reconstructed. The original selltest file (the reported 84) is not in the archive and not in git history. These 19 checks are not that run. 19/19 passed:

- Legacy server: sell-all of 150 cabbage (price 1) sells 100 and leaves 50. Another sale is refused. Crop coins do not enter `coinsEarned`.
- Uncapped server: 150 cabbage plus 40 melon (price 8) pay 470 in one day. The crop line does not show `used/cap`. The furniture line still shows `/400`.
- After uncapped is confirmed, a later status with `sell_cap: 100` and `sell_left: 0` and no `sell_uncapped` flag does not restore the ceiling. A further 80 cabbage still sells.
- A new page load against the legacy status applies 100 again.
- `sell_uncapped: false` plus a numeric left restores the cap in the same session.
- Merit stops at 8 and the task/merit pool stops at 40 after the large crop sales.
- Zero, negative, fractional, and excess quantities are refused and the stored number is not truncated into a sale. A coin total past `MAX_SAFE_INTEGER` is refused.
- If the stack shrinks during the sale, the coins are taken back and the new smaller stack is left in place.
- Furniture: 13 buy-backs of the wood table (30 each = 390) succeed and the 14th is blocked.
- A sell-back whose response is lost stays pending, retries the same request id, and pays once. Putting that same request id back does not pay again.
- A legacy shared pending key is adopted once into the signed-in account. The other account does not replay it and can still move the item. The owning account cannot take it while the sale is pending.
- Offline and online pending copy is the r9c wording.
- Two tabs retrying one request id add the 30 coins in exactly one tab.
- No uncaught page exception on the sale pages.

Smoke of the frozen game, 9 scenes (`gate`, `plaza`, `market`, `yard`, `lotus`, `hall`, `zen`, `study`, `tea`), viewports 390×844 and 844×390. Settled draw calls were between 7 and 98, all ≤ 150. No page errors. The entry-frame peak was not sampled separately (the previous r9c note reported an entry max of 126). No pixel diff was taken.

## Not tested / limits

- The original 84-case selltest was not re-run. It was not in the archive or the repository.
- Production `tg_take_daily` / `tg_daily_used` were not available. Task and merit were tested through a local stub with the same arguments, plus the real draft of `econ_earn`.
- `econ_sellback` itself was not executed in PGlite. The 400 cap was checked as `tg_limit('sellback_coins')` and in the client.
- No Supabase project, no live SQL, no real accounts.
- Crop `econ_earn` still has no request id. A lost crop response can be reported twice to the server. That does not grant client coins twice, and on this draft it does not consume a daily cap. That matches the previous crop path.
- Optimistic client coins can disagree with a server that was rolled back in the middle of the same page session, until reload. That is the fail-safe above, written down rather than papered over.
- Scene smoke did not walk the hall for collisions or compare screenshots.

## How to re-run

SQL (needs `@electric-sql/pglite` resolvable from the absolute import in the test, currently the copy under `/tmp/r9d-deps`):

```
node qa/r9d-uncap/test/sql-local.mjs
```

Browser (needs `puppeteer-core` at the absolute import in the test, and Chrome):

```
node qa/r9d-uncap/test/browser-sale.mjs
```

The recorded run is `qa/r9d-uncap/browser-results.json`.

## Follow-up: original r9c selltest and entry peaks

The original `qa/r9c/tools` archive (`97e3714aab3421585f25396a27c2eaeeb565f5b8b2a38ca8fd29dbd405c49486`) was extracted only as a reference. The runner checked in at `qa/r9c/tools/selltest.mjs` changes two paths and nothing else: `ROOT` is `/workspace`, and Playwright is `qa/tools-node` (`playwright-core` 1.65.1) instead of `/workspace/temple-garden/qa/tools-node`. `BUILD` is the frozen file `v4/index.r9d.html`. No assertion in that file was edited.

Result: **84/84 pass, 0 failures.** `qa/r9c/out/selltest.json`.

| Category | Cases | Result | What it locks |
| --- | --- | --- | --- |
| A | 15 | pass | No backend: shared 40, partial sell-all, merit, local buy-back, 400 cap, visiting, placed item |
| B | 10 | pass | Legacy r9 mock (`sell_cap: 100`, no `sell_uncapped`): crop cap 100, merit not blocked by a full sell cap, shop buy, sell-back request id |
| C | 4 | pass | Old client: shared 40, buy-back hidden |
| D | 3 | pass | Old server: shared 40, buy-back hidden |
| E | 3 | pass | Offline: shared 40, local buy-back |
| F | 10 | pass | Local and server seed, including reload |
| G | 6 | pass | Starter, gift, merit item, family stow, market clamp |
| H | 8 | pass | Dropped response, pending lock, 15 s replay, same request id once |
| I | 5 | pass | Credit shown on first open, probe refresh, refused shop log |
| J | 6 | pass | Per-account pending, offline reason, account switch, signed out |
| K | 4 | pass | Reserved unit cannot be placed or listed; credit-only payout; no second credit |
| L | 10 | pass | Two tabs, Web Locks and the lease fallback, IndexedDB claim once |

Changed crop-cap expectations: **none.** The original mock never sends `sell_uncapped`, so it is still the legacy r9 server. B1 still requires `今日出售 0/100`. B2 still sells 12 melons (96) then 4 cabbage and stops at 100, with `coinsEarned` left at 0. That is the hotfix's compatibility rule, not a leftover 100 on the uncapped server. The uncapped cases (no numeric ceiling, stale `sell_left` ignored) stay in the earlier reconstructed run.

Entry-frame peaks, same method as `smoke-r9c.mjs` section 3b (600 ms after `go`, four yaws, `renderer.info.reset()` then one render). Stable figure is the later single render. Frozen sha256 was `4ecd25c9…` before and after. Page errors 0. Highest entry frame 98 (portrait plaza). Highest stable frame 112 (portrait hall). Both are under 150.

| Scene | Portrait entry (4 yaws) | Portrait stable | Landscape entry | Landscape stable |
| --- | --- | --- | --- | --- |
| plaza | 98, 54, 67, 56 | 66 | 64, 53, 42, 53 | 77 |
| gate | 35, 32, 32, 30 | 43 | 39, 39, 36, 36 | 47 |
| hall | 69, 36, 56, 36 | 112 | 80, 68, 81, 85 | 50 |
| yard | 35, 17, 20, 18 | 50 | 39, 25, 20, 24 | 54 |
| zen | 9, 15, 9, 13 | 23 | 17, 16, 17, 14 | 27 |
| study | 7, 8, 6, 13 | 26 | 16, 11, 15, 14 | 27 |
| market | 31, 29, 28, 33 | 44 | 42, 40, 39, 43 | 55 |
| tea | 50, 38, 41, 43 | 75 | 54, 49, 43, 56 | 79 |
| lotus | 42, 34, 37, 35 | 52 | 45, 41, 41, 44 | 56 |

Full numbers: `qa/r9c/out/smoke-r9d-entry.json`. The frozen HTML was not rewritten. No live database, no player cleanup, no merge.

## Follow-up: audit gates, r9e

The attached findings (extracted from `bc-af38b055-bdf1-530b-b0a1-8282d63cc3eb`) were read. The full `/opt/cursor/artifacts/r9d-audit/AUDIT-zh.md` is not on this machine and was not assumed. Frozen r9d is unchanged: sha256 `4ecd25c97847963860755de0e5caf279405b6d413c08adc277492ac3bd811520`, 1,888,370 bytes.

r9e is the release candidate. `v4/index.r9e.html` sha256 `745f685e65aa324cd0f001aef7f62bd632c1c78dd71ebd217d7c6c3dc468a454`, 1,888,936 bytes. Site `index.html` sha256 `ddd97aee1cb78018336b892d7eee3b93ba23c0dc1b5064373d3459a655a2ea59`, 2,363,576 bytes. Snapshot `qa/r9e-uncap/source-snapshot.tar.gz` sha256 `b25ddf7606fa9eac53fb9a7ed8090846e9a12789b408eda68c09eb61cb30d4ab`, 804,391 bytes.

### Gate 1 — real `tg_take_daily` and `econ_sellback`

Both bodies are in the attached migration archive (`backend/upstream/r6.sql` and `backend/upstream/r9.sql`). An isolated PGlite loaded those texts. `pg_get_functiondef` shows `tg_take_daily` writing `daily_counts` with `for update`, and `econ_sellback` writing `sellback_ledger` against `sellback_coins`. Mocked scaffolding only: `auth.users` and `auth.uid()`. 27/27 in `qa/r9e/sql-real.mjs`.

- Uncapped sell of 50, 101, 5,000, and 9,007,199,254,740,991 is granted. `sell_coins` stays 0.
- Task stops at 40 (`earn_coins` counter is 40). Merit stops at 8 and consumes that same pool. A full task pool does not block a crop sale.
- Real sell-back: 13 wood tables (30 each = 390) succeed, the 14th returns `daily_cap` with left 10. The same request id replays once. Another account does not replay it.
- Rollback sets `sell_uncapped` false and restores the 100 refusal. Sell-back limit stays 400.

Not in the archive, not invented, not executed: `market_listings` table DDL, `tg_market_ttl()`, `tg_can_edit()`, and `showcases`. `market_buy` and `space_save` were not created. If those must be re-checked, the lead needs those definitions read-only.

### Gate 2 — open new page must revoke on explicit false

`backend/r9e-uncap-rollback.sql` returns `sell_uncapped: false` plus the numeric 100. A missing flag still does not restore the cap. On `v4/index.r9e.html`, without reload: uncapped sale of 400, then a stale `sell_left: 0` / `sell_cap: 100` still sells, then explicit false stops the next sale at 100 (150 cabbage → 100 sold, 50 left, `coinsEarned` stays 0). N1–N3 in `qa/r9e/compat.mjs`.

### Gate 3 — old open pages must not fall onto the shared 40

The unchanged r9b page (`a328f7c` `index.html`) only keeps its own crop pool when `sell_left` is a number (`index.html` at that commit, the `typeof st.sell_left === 'number'` branch). It has no unlimited value.

- Proven bad shape, `sell_left: null`: mode is not r9, 10 melons sell as 5, and `coinsEarned` becomes 40. O1.
- r9e status shape, `sell_uncapped: true` together with `sell_cap: 100` and `sell_left: 100`: the old page ignores the flag, stays in r9, sells 96 of melon plus 4 of cabbage, stops at 100, and `coinsEarned` stays 0. O2–O3. A lost sell-back reply leaves the item in the backpack; the later retry of the same request id pays 30 once. O4.

Technical blocker, stated plainly: an already-open r9b/r9c page cannot be made unlimited. Any number it receives becomes a cap. Null drops it onto the shared 40. A huge number would pretend it is unlimited, and this draft does not do that. The 100 in the new status is the ceiling those pages already had. They keep it until the player loads r9e. That load is the gate. Do not describe old pages as unlimited.

### Gate 4 — two-tab crop saves

Not fixed and not claimed safe. Crop coins are still client-side. Two tabs last-write the save. The audit's 10-vs-20 result, and a three-way merge that can keep one side's coins and both inventory deductions, still stand.

### Gate 5 — draw calls on r9e

Same sampler as `smoke-r9c.mjs` section 3b. Page errors 0. Highest entry frame 98 (portrait plaza). Highest later stable frame 79 (landscape tea). Both are at or under 150. `qa/r9e/smoke-entry.json`. This is not the audit's per-render Three.js 76 / single-GL 135 sampler, and it does not replace that note.

### Original 84 on r9e

`qa/r9c/tools/selltest.mjs` against `v4/index.r9e.html`: **84/84, zero assertion edits.** The original mock still does not send `sell_uncapped`, so B1/B2 still require the legacy 100. Categories A–L all pass. `qa/r9e/selltest-r9e.json`.

No fortune stalls. No merge, no deploy, no live SQL.

## Follow-up: r9f, stale earn replies

r9d and r9e are unchanged. r9d sha256 `4ecd25c97847963860755de0e5caf279405b6d413c08adc277492ac3bd811520`, 1,888,370 bytes. r9e sha256 `745f685e65aa324cd0f001aef7f62bd632c1c78dd71ebd217d7c6c3dc468a454`, 1,888,936 bytes.

The audit file named for this round (`/cursor/stores/user/grok-bot/agents/fa69f671-a1f9-4861-b61c-c636c7d7053f/assets/01M7HXHQAW893W30JYNAYYA2T4.md`) is not on this machine. The repro below is the one given in the request, confirmed against the r9e client: `backend/tg-r6.js` used to call `noteSellStatus({ sell_uncapped: true })` on any earn reply that carried the flag, with the epoch stripped off. After a rollback had set the page back to the 100 cap, that late reply turned unlimited on again. The next sale of 80 cabbage was then saved in full. A later server refusal did not take the coins back.

### What r9f does

`public.sell_policy` is one row. `epoch` only increases. `uncapped` is the live crop mode. Forward (`backend/r9f-uncap.sql`) bumps the epoch and sets uncapped true. Rollback (`backend/r9f-uncap-rollback.sql`) bumps the epoch and sets uncapped false. Both files install the same `econ_earn` and `econ_status`. `tg_limit('sell_coins')` stays NULL. While the row is capped, the value passed to the real `tg_take_daily` is the literal 100. There is no larger number.

`econ_earn` is now four arguments. The fourth, `p_req`, defaults to null, and the three-argument function is dropped so PostgREST has one function. Callers that omit `p_req` still run. A successful call with `p_req` is stored in `econ_earn_reqs` together with the epoch it was decided under. Replaying that request returns the stored grant and that old epoch. The replay does not change `sell_policy` and does not take the coins again. A refusal is not stored, so the same request id can be tried again and is judged against the policy at that later moment.

On the page, once this account has applied an epoch of 1 or more, a reply with no `sell_epoch`, or with an older one, cannot change crop mode. `sell_uncapped: false` with a newer epoch revokes unlimited with no reload. A newer epoch with true can turn it back on. The account id is stored with the epoch (`templeGarden.r9.sellEpoch.<account>`). A missing key is not treated as epoch 0. `tg-r6.js` no longer invents `sell_uncapped: true`. It forwards the real reply, and only while the account that started the call is still the signed-in account.

After an epoch has been applied, a crop sale in r9 or uncapped mode reserves the items: the inventory deduction and the request id are written in one save before the server is asked. Coins are added only when that request comes back granted. A hard refusal puts the items back in that same save and adds no coins. A network error keeps the reservation and retries the same request id. Switching account while the reply is in flight does not pay the account now on screen; the reservation stays for the account that started it. Reloading retries the saved reservation once. `S.cropApplied` records the request id in the save, so a second arrival does not pay again. Coins that were never added are not clawed back later.

Before any epoch has been seen, crop sales stay on the synchronous `earn()` path. That is the old three-argument server, and it is what the original 84 mock speaks.

### The repro, on the frozen page

Cabbage sells for 1 coin. After rollback to epoch 5 with 40 already used (60 left), these replies were injected: `sell_uncapped: true` with no epoch, the same flag with epoch 1, and the same flag with epoch 4. Mode stayed r9, epoch 5. Selling 80 cabbage paid 60, left 20, `coinsEarned` stayed 0, and the save matched the screen. `qa/r9f/race.mjs`.

An 80-cabbage sale started while uncapped is held with the items reserved and the coins unchanged. If that call is then refused (`daily_cap`, epoch 7), the 80 return and the coins stay unchanged. If the server had already committed the 80 under epoch 8, the reply pays 80 and the page stays on the newer capped epoch. A reply that arrives after the account has switched does not pay; switching back settles that same request once. Three network errors keep the reservation; the retry of the same request pays once. Reloading with the reservation still in the save pays once and the second retry pays nothing.

The published r9b page (`a328f7c` site HTML), given a status that includes `sell_uncapped: true`, `sell_epoch: 4`, and `sell_left: 100`, stays in r9 at cap 100. With 40 already used, 80 cabbage pays 60 and `coinsEarned` stays 0.

### Counts

- Isolated SQL, real `tg_take_daily` and real `econ_sellback`, then the r9f drafts: **48/48**. `qa/r9f/sql-epoch.mjs`. Furniture still stops at 400 (13×30 = 390, the 14th left 10). Task stops at 40. Merit stops at 8 inside that pool. An uncapped sale of the JS safe integer is granted and writes no `sell_coins` row. After rollback, replaying the pre-rollback grant of 5,000 returns epoch 1 and does not turn the row back to uncapped. An exact 80 against 60 left is refused and the counter stays 40. An exact 60 fills it. Replaying the 60 does not take it twice. Forward again is epoch 3 and grants 250. A second rollback is epoch 4. One `econ_earn` function remains.
- Adversarial page sequences, including the real `tg-r6.js` on `v4/index.r9f.html`: **21/21**. `qa/r9f/race.mjs`.
- Original `qa/r9c/tools/selltest.mjs` against `v4/index.r9f.html`: **84/84, zero assertion edits.** The mock still sends no `sell_uncapped` and no `confirmSell`, so B1/B2 still require the legacy 100. `qa/r9f/selltest-r9f.json`.
- Entry and steady draw, both orientations, nine scenes: errors 0. Highest entry frame 85 (landscape hall). Highest steady frame 79 (landscape tea). Both are at or under 150. `qa/r9f/smoke-entry.json`.

A first 84 run failed 7 cases because a missing epoch key was read as 0, and a status with no epoch was then ignored. The shipped `loadEpoch` treats a missing key as no epoch. The 84/84 figure is the run after that fix.

### Checksums

- `v4/index.r9f.html` sha256 `1e0b4ce1fd29d4403e9c1a527f5d03ed3cf1a00404c2e553fbeb9a93b0654d54`, 1,895,667 bytes
- site `index.html` sha256 `882cbc7f229d4b3bb42b5e7d138373bc7fa3da01c4fe6e0c702e0990003da0a3`, 2,371,770 bytes
- snapshot `qa/r9f-uncap/source-snapshot.tar.gz` sha256 `fda0e2a28000f5e911ceb9de8f7950a4bcaa4640e043152a0193a5deccaf7c4e`, 862,436 bytes
- `backend/r9f-uncap.sql` sha256 `d02c132256055b6adead600a983e8c31875499123afb5a22e477b49467cd0912`, 8,849 bytes
- `backend/r9f-uncap-rollback.sql` sha256 `9348870fd2b686b131ceef46eaf47a1cf519143afccf64f7c96c333d1ecf59db`, 8,575 bytes
- `backend/tg-r6.js` sha256 `c30727d8509cc5f12e68fd9a6e4502f3470e814246dca7d25d232799857a9682`, 37,635 bytes

Diffs from r9e: `qa/r9f-uncap/r9-sell-from-r9e.patch`, `qa/r9f-uncap/tg-r6-from-r9e.patch`. Full list: `qa/r9f-uncap/SHA256SUMS.txt`.

### Limits that remain

- An already-open r9b or r9c page has no unlimited signal and still adds crop coins before the server answers. A later refusal on that old page does not remove those coins. Loading r9f is the gate. The 100 in the status is the ceiling those pages already had, so they do not fall onto the shared 40.
- An r9f page that has already stored an epoch only moves mode for a reply that carries an equal or newer `sell_epoch`. The r9e rollback sets `sell_uncapped` false and carries no epoch, and it creates the three-argument function beside this four-argument one. Use `backend/r9f-uncap-rollback.sql` to roll r9f back. A page that has never stored an epoch still honors a false with no epoch.
- Crop sales made before the first epoch arrives are still optimistic. That window closes once r9f status has been applied.
- Two browser tabs can still last-write-wins a crop save. This round does not call that safe. A single tab retries its own reservation one at a time.
- If adding the granted coins would pass the largest safe integer, the reservation stays and is retried. The items stay reserved while that grant is outstanding.
- `market_listings`, `tg_market_ttl`, `tg_can_edit`, and showcases are still absent from the executed SQL. `market_buy` was not run. `tg_take_daily` and `econ_sellback` are the upstream bodies. `auth.users` and `auth.uid()` are local scaffolding.
- Each earn takes a row lock on `sell_policy`, so a policy change and an in-flight earn cannot tear. That is a short lock, not another coin cap.
- A sale the server already committed under the old epoch is paid when its reply arrives. The reply does not turn uncapped back on.

No fortune stalls. No merge, no deploy, no live SQL, no player-data changes.

## Follow-up: r9g, no sale before status

r9f is unchanged: `v4/index.r9f.html` sha256 `1e0b4ce1fd29d4403e9c1a527f5d03ed3cf1a00404c2e553fbeb9a93b0654d54`, 1,895,667 bytes. `backend/tg-r6.js` is unchanged, sha256 `c30727d8509cc5f12e68fd9a6e4502f3470e814246dca7d25d232799857a9682`. There is no new SQL. The r9f epoch drafts are still the server protocol. Isolated SQL was re-run: **48/48**.

r9f left a hole on the new page. Until the first `sell_epoch` arrived, a crop sale used the synchronous `earn()` path. Selling before status returned, or while status was delayed, could save coins the server later refused. That gate was not closed.

### What r9g does

A shop that can answer `status`, and a signed-in account whose client is not loaded yet, does not sell crops until status has classified that account. Inventory and coins stay as they were. The crop tab says `正在核对今日的出售规则，请稍候` and the sell buttons are disabled. An earn reply cannot perform that classification. `sell_uncapped: true` arriving before status does not turn unlimited on.

A status `error`, or a thrown status call, stays pending and is retried. It is not turned into the offline shared 40. A status that omits `sell_epoch` after this account has already stored one does not downgrade the account to the synchronous path either.

Once status carries `sell_epoch`, the class is `epoch` and every crop sale, including the first, reserves the items and adds coins only when that request is granted. A hard refusal puts the items back in the same save.

Switching account bumps a generation, clears the in-memory mode, and loads only the new account's stored epoch. The previous account's in-flight status is dropped. The new account cannot sell until its own status arrives, so it does not inherit unlimited and it does not get an optimistic window.

These paths stay on the old rules, and only after they have been told apart from a pending shop:

- No shop client at all, and nobody is signed in: local shared 40.
- Shop client without the r9 functions: old-client shared 40.
- Status with a numeric `sell_left` and no `sell_epoch`: the legacy r9 cap, synchronous `earn()`.
- Status with a day and no sell fields: old-server shared 40.
- Explicit `offline`, and this account has never stored an epoch: offline shared 40.

The original 84 assertions were not edited. That harness already awaits `probe()` before it sells, so it never sits in the new waiting state. **84/84.**

If a confirmed grant does not fit in the safe integer range, the reservation stays and the items stay reserved. Automatic retry stops on the third overflow. The tab shows `这笔出售商铺已经收下，但铜钱多到加不进去。先花掉一些，再点确认。自动重试已停。` and a button. Spending coins and pressing it pays once.

### Counts on r9g

- First-status sequences, fresh storage, real `tg-r6.js`: **16/16**. `qa/r9g/first-status.mjs`. Covered: status held, stale earn before status, rollback as the first status then 80 cabbage pays 60, refused settlement restores the stack, status error then retry, account switch before the first response, unlimited first sale, overflow stop and one later confirmation.
- Original selltest: **84/84**, no assertion edits. `qa/r9g/selltest-r9g.json`.
- Entry and steady draw, both orientations: errors 0. Highest entry frame 98 (portrait plaza). Highest steady frame 80 (landscape plaza). `qa/r9g/smoke-entry.json`.

### Checksums

- `v4/index.r9g.html` sha256 `b19a1d8b44f9a47625c3c4304c4317acf7129ec02716ad0fcab4a89311245028`, 1,900,574 bytes
- site `index.html` sha256 `c8920f16c44dfa331ad0801fa6a1870ce4032d2733aaafc6de8c6503580a0c90`, 2,376,677 bytes
- snapshot `qa/r9g-uncap/source-snapshot.tar.gz` sha256 `edaf8c83406692009c947cd5436e8b3fb257ae3b35a737401e6eae22aaa47f87`, 847,851 bytes

Diff from r9f: `qa/r9g-uncap/r9-sell-from-r9f.patch`.

### Limits that remain

- After status has classified the server as legacy (no `sell_epoch`), crop sales still credit through synchronous `earn()`. A later refusal on that old server can still leave coins. The new page does not do that before classification, and it does not do that once `sell_epoch` is known.
- An already-open r9b page still credits before the server answers. Loading r9g is the gate.
- An account that has stored an epoch keeps waiting if a later status has no epoch. Sales stay blocked instead of falling back to the shared 40.
- Explicit offline with no stored epoch still uses the shared 40. That is the offline rule the original tests require.
- Two browser tabs can still last-write-wins a crop save.
- The r9e rollback still has no epoch. Roll r9f/r9g back with `backend/r9f-uncap-rollback.sql`.

No fortune stalls. No merge, no deploy, no live SQL, no player-data changes.


