# r9h-q candidate — pause on conflict, keep both snapshots

This is an isolated candidate. It is not a freeze, not r9i, and not a claim that the game can ship. Frozen `v4/index.r9d.html` through `v4/index.r9h.html`, the published `index.html`, and `backend/tg-r6.js` were not modified. No live SQL was run and no player row was read or written.

## Safety boundary, before the code

A page can pause only after it has seen a conflict. It cannot see a sale that the other device has not synced, and it cannot stop that device from calling `econ_earn` first. If both devices finish `confirmSell` before either `save_put` conflicts, the server has two committed grants. Nothing on the client can undo them. The candidate records that grant as a proof and does not add the coins a second time, and it does not restore the reserved stack.

A direct `save_put`, or any client that ignores the journal, can replace the cloud blob. The journal then survives only in the detecting device's `localStorage`. That was observed: after the pause, a raw `save_put` replaced the cloud with coins 1 and cabbage 12, and the detecting device's journal still held the local receipt of 4 cabbage.

Because the page cannot enforce the pause on the other device, and because a last write can drop the pause from the cloud, the candidate stops at the client behavior below and includes an unexecuted server draft. Passing the scripted conflict does not make this production-safe.

## What the candidate does

Version string `r9h-q`.

- `save_put` conflict and a dirty load against a newer cloud call `holdConflict` instead of `merge3`. The first divergent pair is written to `templeGarden.r9.cropQuarantine.<account>` before any adoption. Later conflicts do not replace that pair.
- The pair stores coins, merit, inventory, `cropPending`, and `cropApplied` for local, remote, and base, plus the remote revision.
- If those crop fields are identical, the device takes the server revision and does not pause. An autosave that only moves `_wid` or `_savedAt` is not a crop conflict. A furniture-only divergence is also not quarantined; the next save can still last-write those fields. That is not a stock merge.
- While the journal is paused, sell, direct crop `r6EarnCoins`, retry, and resume do not pay, do not debit further, and do not restore. A device-local crop pending key is not read back into the payable set.
- Reload of the detecting device returns its local save and does not adopt the cloud or upload over it. A second tab in the same browser sees the same journal.
- A malformed `ok: true` grant (null, scientific notation, a non-canonical decimal, a boolean, padding, a leading zero) keeps the debit and the receipt and marks `bad_grant`. It does not restore stock. A canonical decimal string whose `Number()` is the same safe integer is a real grant.
- The function registered with `setInterval(..., 300000)` is `refreshMir`. It calls `sell.probe()`, so a later status can apply a rollback. Earn replies still do not change mode.
- An in-flight grant that the server already returned is appended to `templeGarden.r9.grantProofs.<account>` and is not paid and not restored after the pause. The proof is not a rollback. The grant, if the server stored it, remains committed.
- `merge3` still contains the old receipt union and inventory floor. The conflict path does not call it. Calling `_merge3` directly would still amplify. Do not treat that function as the candidate strategy.
- A timed-out write whose server state carries this device's own `_wid` is still replaced by the newer local state. That path is a same-device retry, not a cross-device conflict.

The shop line while paused is 「作物出售已暂停：另一台设备的存档有冲突，双方记录已保留，不会自动合并、发钱或退回」. The journal JSON is shown on the sell sheet. There is no automatic winner and no automatic resolution.

## What was run

Two independent browser contexts, the candidate site, and a local `save_put` that returns `conflict` when `p_base_rev` is stale. Replay goes through `retryCrops`, `resumeCrops`, `sellCrop`, and `r6EarnCoins`. It does not call `merge3`.

Shared base before the divergence: coins 100, merit 9, cabbage 12.

| Side | Coins | Cabbage | Receipts |
| --- | --- | --- | --- |
| Base | 100 | 12 | none |
| Device A, uploaded | 100 | 7 | `crop-dev-a-0001` pending 5 |
| Device B, local, conflict | 103 | 8 | `crop-dev-b-0001` pending 4 |

After B's conflicting `save_put`:

- B's journal holds both of those snapshots and the base. Cloud revision stayed on A's upload: cabbage 7, coins 100, only A's receipt. No union and no inventory floor.
- Retry, resume, a full sell, a direct crop earn, an offline retry, and an injected localStorage receipt left B at coins 103 and cabbage 8. The earn hook was not called.
- A was not paused. A's later save landed and advanced the cloud revision.
- Reload of B kept coins 103, cabbage 8, and the journal, and did not upload.
- A second tab of B stayed at coins 103 and cabbage 8 and could not sell.
- On the same page, account `other-user` was not paused and sold 1 cabbage (coins 10 → 11, cabbage 3 → 2). Switching back to `merge-user` blocked the next sell and left the journal bytes unchanged. The page's cloud writer stays held for every account on that page; a different browser signed into another account is not paused.
- A raw `save_put` replaced the cloud with coins 1 and cabbage 12 and no receipts. B's journal still had the local receipt of 4.

Same request id, after a fresh shared base of cabbage 12 and coins 100:

- Remote: coins 108, cabbage 4, `crop-same-0001` applied.
- Local: coins 100, cabbage 4, the same id pending for 8.
- Replay left coins 100 and cabbage 4 and made no earn call. The applied credit was not paid again and was not removed.

In-flight grant, after a shared base of coins 50 and cabbage 20:

- The other device moved the cloud to coins 60 and cabbage 20 while this device's sale of 1 was held.
- The debit upload then conflicted. Journal local: coins 50, cabbage 19, pending 1. Journal remote: coins 60, cabbage 20.
- The grant of 1 was stored as a proof. Coins stayed 50. Cabbage stayed 19. Stock was not restored. The test cannot say the server grant was rolled back; the hook had already accepted it.

Candidate regressions on `v4/index.r9h-q-candidate.html`, using the candidate `tg-r6.js`:

- Provenance: an earn before the delayed status does not authorize unlimited. Status epoch 7 false caps the page. Earn true at epoch 7, earn true at epoch 9, and earn true with no epoch leave epoch 7 capped. Account switch clears the mode and does not sell.
- Settlement paid 2147483647, 2147483648, 3000000000, and 9007199254740991. 268435456 melons paid 2147483648. A product past the safe integer was refused with coins 11 and the inventory unchanged.
- Overflow stopped after three tries with the existing manual-resume reason. After spending, resume paid the reserved crop once (coins 11).
- Reload of an open reservation paid it once (5 → 14) and a second retry did not pay again.
- Malformed `ok: true` grants `null`, `3e9`, `3000000000.0`, `true`, ` 3`, and `03` each left coins 40, cabbage 5, and `bad_grant`. Retry did not restore. The canonical string `3000000000` paid, coins 1 → 3000000001.
- The function captured from `setInterval` at 300000 ms applied epoch 8 uncapped false. The test did not call `noteSellStatus` itself for that check.
- Result: 25/25. `qa/r9h-candidate/regress.json`.

Original selltest, assertions not edited: 84/84 on `v4/index.r9h-q-candidate.html`. `qa/r9h-candidate/selltest-r9h-q.json`.

Two-browser conflict: 13/13. `qa/r9h-candidate/conflict.json`.

## What was not run

No live SQL. The draft was not applied to PGlite either. No draw-call smoke on this candidate. No player data. The scripted conflict uses a local conflict response; it does not prove that two real sessions, with real `econ_earn` commits racing ahead of `save_put`, will pause in time.

## Server draft, not applied

`qa/r9h-candidate/SERVER-QUARANTINE-DRAFT.sql`.

It adds `crop_hold` and the two snapshots on the existing `saves` row. `save_put` would refuse, including the current unconditional `p_base_rev null` reset, while the flag is set. `save_quarantine` stores the first pair at the current revision and does not replace it. A new crop `econ_earn` would return `reason: quarantine` without inserting `econ_earn_reqs`. An already stored grant stays. An optional `crop_begin` lease of 120 seconds can reject a second device, but an old client never calls it, a crashed holder is cleared only by the TTL, and one device can still oversell because harvest is not on the server. This is not a stock ledger.

Rollout if that draft were ever applied: a page published first still pauses only locally. SQL applied first makes an old optimistic page see `ok: false` after it may already have credited coins. The refusal does not claw those coins back, and an old page that restores stock on any refusal would restore stock for a pause. This candidate does not do that.

## Files

- `v4/index.r9h-q-candidate.html` sha256 `c50f08af97c5ba6f9334ee7faf9f90a921bff142b737fec288e2e2e6792bc251`, 1,905,105 bytes
- `qa/r9h-candidate/site.html` sha256 `b7ec9109fc228eb04ac1be7981ed411728bedc45a5c983048fbeeda693043ef2`, 2,386,105 bytes
- `qa/r9h-candidate/tg-r6.js` sha256 `9e86026184d18f2a776db538abde76aba3efbbd6b262281e8adac249c348adbd`, 37,939 bytes

Frozen r9h remains sha256 `92b0b39b61bb7c13a10ee9de0eb10a74eb751f80ff715aac016de9f19d8423d1`. Published `index.html` remains `cb16d57350901f2a3097e5fc0c0fa31ccac5c591e0bd8bfee824b70de54befc6`. `backend/tg-r6.js` remains `0a01050b19122e06cc3d0f6ce5bde134993581e4d312d9d4c7f6d354e63fde8e`.
