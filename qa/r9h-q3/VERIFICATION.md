# r9h-q3 candidate — review fixes

This is a candidate, not a release. Frozen `v4/index.r9d.html` through `v4/index.r9h.html` and the live site `index.html` were not modified. No live SQL was applied. The published page is still r9h. Opening that page does not get this client pause. The SQL in `backend/r9h-q2-hold.sql` and this candidate page have to take effect together. Players have to open `v4/index.r9h-q3-candidate.html` (or the candidate site built from it), not the current r9h site page.

## What changed after the r9h-q2 review

1. A logged-in player cannot lift a hold by setting `tg.crop_hold_mgr`. The trigger no longer reads any session setting. While `crop_hold` is true, a direct `UPDATE` raises `crop_hold`. `authenticated` is also revoked from `INSERT` / `UPDATE` / `DELETE` on `saves`, so a normal player cannot write the table at all. `crop_hold_clear()` is still not granted to `authenticated`. It disables the trigger only inside that owner function, then clears the flag and the snapshot values.

2. `backend/r9f-uncap-rollback.sql` must not be applied by itself on top of the hold. That file replaces `econ_earn` and moves `sell_policy`, and it leaves the hold's `save_put` in place. On an isolated database that mix paid a new earn of 11, moved the epoch from 1 to 2, set uncapped false, and `save_put` still returned `quarantine`. The only hold rollback is `backend/r9h-q2-hold-rollback.sql`. It restores the r7.2 save functions and the r9f forward earn body, does not move the epoch, and clears `crop_hold` plus the snapshot values so they cannot silently re-freeze. Copy `crop_hold_review()` first if that evidence must be kept. Re-applying the hold draft after that rollback did not revive the old pair. The clear is the operator's explicit rollback. It is not a choice of which device's coins win.

3. A crop sale on the confirmed path asks `econ_status` before it debits inventory or adds coins. Deleting `templeGarden.r9.cropQuarantine.<account>` is not enough to resume. On the re-test, coins stayed 1 and cabbage stayed 2, the local key was written again from the server, and both `econ_earn` and `save_put` returned `quarantine`.

New `econ_earn` calls of every source, including task, are refused while the hold is set. A task earn of 5 returned `quarantine` and stored no request. Furniture sell-back is a different function. Its body was not changed, and the 13×30 suite was not re-run.

## Lock order

The advisory lock is taken before the `saves` row lock. That is what the functions do. Two game RPCs that follow that order did not deadlock each other in the re-test: one session held the advisory lock, the other `econ_earn` waited, and after the hold committed the waiter returned `quarantine` and inserted nothing. Residual risk: a session that already holds `saves FOR UPDATE`, and then calls `save_put` or `econ_earn`, can raise `deadlock detected`, because the function takes the advisory lock and then waits for the same row. Do not hold the row lock and call the RPC.

## What still remains

A grant that commits before the hold still stands. Two devices can both finish `econ_earn` before either `save_put` conflicts. Those grants are not revoked. The re-test replayed a pre-hold grant of 5 and did not pay it again on the paused page.

An already-open old page can add coins locally before it sees a refusal. Those coins cannot be clawed back. An r9b page was not re-tested in this round. Do not treat an older r9b note as a new result.

Harvest, gifts, and meals are still client-side. Local oversell before sync was not tested. This is not a stock ledger.

The hold does not cover furniture sell-back. That 400/day path was not replaced and was not re-run here.

`auth.uid()` in the isolated database reads `app.uid`. That is test scaffolding. The function bodies do not take a caller-chosen account.

## Re-ran on this candidate

Isolated Postgres, real `save_put` / `save_quarantine` / `econ_earn`, including the GUC update, the task refusal, the companion rollback, the re-apply, and the standalone r9f rollback mix: 24/24. `qa/r9h-q3/sql-hold.json`.

Two browsers on that database, including the deleted local key: 12/12. `qa/r9h-q3/browser-hold.json`. The reviewer's earlier pass did not attach two browsers; this run did.

Provenance, safe-integer settlement, overflow, the 5-minute callback, and malformed grants on `v4/index.r9h-q3-candidate.html`: 25/25. `qa/r9h-q3/regress.json`.

Original selltest, assertions not edited: 84/84. `qa/r9h-q3/selltest-r9h-q3.json`.

Not re-tested: an r9b sell button, furniture 13×30, harvest/gift/meal oversell, and a session that locks the row before calling the RPC.

## Files

- `v4/index.r9h-q3-candidate.html` sha256 `7742a30f8ccd6324968bc55b4bc3e1b68c8fc4970dc47e6894a571b2537bfc5b`, 1,906,781 bytes
- `qa/r9h-q3/site.html` sha256 `1110acce5f19d67aadf5fd3ff7d2735023a54fc621efbe945e9d6002ed92810d`, 2,390,880 bytes
- `qa/r9h-q3/source-snapshot.tar.gz` sha256 `8735098bfd2c410012fe6bd405943b2d8a0a33421db618fde8f2096557f9ddda`, 35,868 bytes

Frozen r9h remains `92b0b39b61bb7c13a10ee9de0eb10a74eb751f80ff715aac016de9f19d8423d1`. Live `index.html` remains `cb16d57350901f2a3097e5fc0c0fa31ccac5c591e0bd8bfee824b70de54befc6`. `backend/tg-r6.js` remains `0a01050b19122e06cc3d0f6ce5bde134993581e4d312d9d4c7f6d354e63fde8e`. `backend/r9f-uncap.sql` remains `d02c132256055b6adead600a983e8c31875499123afb5a22e477b49467cd0912`. `backend/r9f-uncap-rollback.sql` gained a warning comment only; its epoch logic was not changed. Its sha256 is now `e634496f8b92035f3e6af0f54914a80aad93336dc0334dcde6a32bbdbd4ef6a0`.
