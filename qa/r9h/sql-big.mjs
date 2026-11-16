// The uncapped earn path must return these amounts unchanged. Isolated PGlite, r9f SQL, no live database.
import { PGlite } from '/tmp/r9d-deps/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const r6 = fs.readFileSync(path.join(root, 'backend/upstream/r6.sql'), 'utf8');
const r9 = fs.readFileSync(path.join(root, 'backend/upstream/r9.sql'), 'utf8');
const forward = fs.readFileSync(path.join(root, 'backend/r9f-uncap.sql'), 'utf8');
const slice = (text, start, end) => { const i = text.indexOf(start); const j = end ? text.indexOf(end, i) : text.length; return text.slice(i, j); };
const db = new PGlite();
const A = '00000000-0000-0000-0000-0000000000aa';
await db.exec(`create schema if not exists auth; create table if not exists auth.users (id uuid primary key);
 insert into auth.users(id) values ('${A}');
 create or replace function auth.uid() returns uuid language sql stable as $$ select '${A}'::uuid $$;
 do $$ begin
   if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
   if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 end $$;`);
await db.exec([slice(r6, 'create or replace function public.tg_day', 'create table if not exists public.daily_counts'), slice(r6, 'create table if not exists public.daily_counts', '-- tunable limits'), slice(r6, 'create table if not exists public.crop_rules', 'create or replace function public.tg_max_grow_ms'), slice(r9, 'create or replace function public.tg_limit', '-- ---------- 5. fix: market_buy')].join('\n'));
await db.exec(forward.replace(/notify pgrst, 'reload schema';\s*$/, ''));
const amounts = ['2147483647', '2147483648', '3000000000', '9007199254740991'];
let failed = 0;
for (const n of amounts) {
  const row = (await db.query(`select (public.econ_earn(${n}::bigint, 'sell', true, 'crop-big-${String(amounts.indexOf(n)).padStart(2, '0')}')->>'granted') as g`)).rows[0];
  const ok = row.g === n;
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', 'sql grant', n, row.g);
}
console.log(JSON.stringify({ passed: amounts.length - failed, failed, total: amounts.length }));
if (failed) process.exit(1);
