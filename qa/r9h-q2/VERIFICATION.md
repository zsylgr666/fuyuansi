# r9h-q2 candidate — server crop hold

This is a candidate, not a freeze and not a ship decision. Frozen `v4/index.r9d.html` through `v4/index.r9h.html`, published `index.html`, `backend/tg-r6.js`, and the r9f epoch SQL were not modified. No live SQL was applied and no player row was read.

r9h-q paused only the browser that had already seen a conflict. r9h-q2 keeps that client behavior and adds a server hold so the other device’s `save_put`, unconditional reset, and new crop grant are refused after the hold transaction commits.

## Lock order

Every function that needs more than one of these locks takes them in this order:

1. `pg_advisory_xact_lock(hashtext('tg_save:' || uid))`
2. `saves` row `FOR UPDATE`
3. `pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid))` — earn only
4. `sell_policy` row `FOR UPDATE` — earn only

`save_put` and `save_quarantine` stop at step 2. They cannot deadlock with `econ_earn`. A new crop grant is inserted only after step 2 has seen `crop_hold = false`. If the hold commits first, the waiting earn returns `reason: quarantine` and inserts nothing. If the grant commits first, it stays. Later calls replay that stored row. The hold does not delete it.

The account is always `auth.uid()`. None of these functions take a caller-chosen owner. In this isolated database, `auth.uid()` reads the session setting `app.uid`. That is test scaffolding. The function bodies are the production-intended ones.

## What the server stores

`save_quarantine(p_base_rev, p_local, p_remote, p_base, p_device, p_source)` sets the hold only when `p_base_rev` equals the current `saves.rev` and the hold is not already set. It stores both snapshots, the base (which may be null), `hold_rev`, `hold_device`, `hold_source` (`save_conflict` only), and `hold_at`. It does not replace `saves.state` and it does not bump `rev`. A second call returns the original pair. A stale revision returns `conflict` and does not set the hold.

While the hold is set:

- `save_put`, including `p_base_rev null`, returns `quarantine` and does not write.
- A direct `UPDATE` of the row raises `crop_hold`.
- A new crop `econ_earn` returns `quarantine` and does not insert `econ_earn_reqs`.
- An already stored request id replays its original `granted` value. The client records that as evidence and does not add coins or restore inventory.
- Task earn is not a crop grant and still runs. That is deliberate.
- `crop_hold_clear()` exists for an operator and is not granted to `anon` or `authenticated`. Logout, reset, and time do not call it. There is no TTL.

`crop_hold_review()` returns the signed-in account’s evidence only.

The rollback draft restores r7.2 `save_get` / `save_put` and the r9f `econ_earn` / `econ_status`. It does not change `sell_policy.epoch`, does not drop `econ_earn_reqs`, and does not drop the snapshot columns. After that rollback the hold is no longer enforced, so a later save can replace state again. The columns are still there. The rollback does not choose a winner.

## Client

Version `r9h-q2`. On `conflict`, the page calls `save_quarantine` with the local snapshot, the remote snapshot, and the base, then pauses. On `quarantine` or `crop_hold` from `save_get`, `save_put`, reset, or status, it pauses even when this browser has no local journal. A fresh device loads the server pair and does not upload over it. Sell, retry, resume, direct crop earn, and reset do not pay, restore, or clear the hold.

Malformed `ok: true` grants still keep the debit and the receipt. The 5-minute callback still calls `probe()`. Only a status reply changes epoch. Safe-integer grants are unchanged.

## What was run

Isolated PostgreSQL 16. The loaded chain is `schema.sql` saves, the r6 daily helpers, `tg_req_ok`, the r7.2 `save_put`, `r9f-uncap.sql`, then `r9h-q2-hold.sql`. 20/20 in `qa/r9h-q2/sql-hold.json`.

One interleaving held the save advisory lock, started `econ_earn` for a new request on a second session, and observed that session waiting. The first session then set the hold and committed. The waiting earn returned `quarantine` and inserted no row. A grant committed before that hold still replayed `granted: 1`. A `save_put` reset that waited on the same lock was refused and the snapshots stayed (local coins 40, cabbage 19; remote coins 60, cabbage 20; base coins 50, cabbage 20).

The hold migration left epoch 1 uncapped. The rollback draft left epoch 1, left the stored snapshots, and a new earn of 3 then succeeded because enforcement was lifted.

Two browser contexts used those same functions as the transport. `avatar_me` and `lotus_status` answers in that test server are stubs. Saves and earns are not.

Shared base: coins 100, merit 9, cabbage 12. A pre-hold earn stored grant 5 for `crop-prehold-0001`.

| Side | Coins | Cabbage | Receipts |
| --- | --- | --- | --- |
| Base | 100 | 12 | none |
| Device A, the current revision | 90 | 7 | pending `crop-dev-a-0001` ×5, applied `crop-prehold-0001` |
| Device B, the stale writer | 80 | 8 | pending `crop-dev-b-0001` ×4 and `crop-prehold-0001` ×5, applied `crop-dev-a-0001` |

The cloud `state` stayed at A’s 90/7. The hold row kept B as `hold_local` and A as `hold_remote`, plus the base of 12. B’s retry, resume, sell, direct earn, and offline sell left coins 80 and cabbage 8. The old grant was still 5 and was not paid again. A’s later save did not change rev 3. A fresh third context read local 80 and remote 90, could not sell, and did not change the row. Reset was refused. A raw `save_put` and a new earn were refused. The old request replayed 5.

Account B, in its own browser, was not held and sold 1 cabbage (coins 10 → 11, cabbage 3 → 2). Switching the paused page back to account A stayed paused. Account A’s snapshots stayed at 80 and 90.

An r9b page called `econ_earn` for 6 coins after the hold. The server returned `quarantine` and stored no request. The page’s local coins stayed 40. That call does not by itself drive r9b’s optimistic sell button. An already-open r9b tab that added coins before the response still has those coins. This server never sees them and cannot take them back.

Candidate regressions on `v4/index.r9h-q2-candidate.html`: 25/25, including the four safe-integer grants, provenance, the real 5-minute callback applying epoch 8 uncapped false, and malformed grants. Original selltest: 84/84, assertions not edited.

Browser hold: 12/12. `qa/r9h-q2/browser-hold.json`.

## Boundaries that remain

A grant that commits before the hold transaction commits is permanent. Two devices can both finish `econ_earn` before either `save_put` conflicts. The hold does not prevent that, and it does not revoke it.

The hold is not a stock ledger. Harvest, gifts, and meals are still client-side. One device can still oversell its own local inventory before it syncs.

An old optimistic page can keep coins it already saved. Publishing this page before the SQL means the other device is still only paused locally. Applying the SQL before the page means an old page sees `ok: false` after it may already have credited. The refusal does not claw those coins back.

`crop_hold_clear` is not wired to the game. There is no automatic resume and no automatic winner. After an operator cleared the row, this client would still not pay the disputed receipts on its own; a browser that had never stored a journal would see `crop_hold: false` and could sell again. That operator function was not granted to players and was not run against any live account.

The rollback draft lifts the block. It should not be applied on top of r9f if the intent is to keep the hold. It does not replace `r9f-uncap-rollback.sql`.

## Files

- `v4/index.r9h-q2-candidate.html` sha256 `c6249aecc59438b204d365146bfc91242752dce283a26967dcd15f6a1ddea2ad`, 1,906,350 bytes
- `qa/r9h-q2/site.html` sha256 `2cbf2bd7a149df138f9ed50bb68eca3ec31eb7e66098a14fc10ff8f4e241795f`, 2,390,449 bytes
- `qa/r9h-q2/source-snapshot.tar.gz` sha256 `106191858ef68b956ad64549752eae0c6291bef3006c778e5da2a42f61739f67`, 35,161 bytes
- `backend/r9h-q2-hold.sql`, `backend/r9h-q2-hold-rollback.sql`

Frozen r9h remains `92b0b39b61bb7c13a10ee9de0eb10a74eb751f80ff715aac016de9f19d8423d1`. Published `index.html` remains `cb16d57350901f2a3097e5fc0c0fa31ccac5c591e0bd8bfee824b70de54befc6`. `backend/tg-r6.js` remains `0a01050b19122e06cc3d0f6ce5bde134993581e4d312d9d4c7f6d354e63fde8e`. r9f forward remains `d02c132256055b6adead600a983e8c31875499123afb5a22e477b49467cd0912`.
