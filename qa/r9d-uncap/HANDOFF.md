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
