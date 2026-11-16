// Loads the production save_put / econ_earn chain and the r9h-q2 hold draft into a local database.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pg-node/package.json');
const { Client } = require('pg');
const root = '/workspace';
export const pgCfg = { host: '/tmp/pg/sock', user: 'ubuntu' };
function slice(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) throw new Error('missing ' + start);
  const j = end ? text.indexOf(end, i) : text.length;
  return text.slice(i, j < 0 ? text.length : j);
}
export async function loadDb(db) {
  const boot = new Client({ ...pgCfg, database: 'postgres' });
  await boot.connect();
  await boot.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid <> pg_backend_pid()`, [db]);
  await boot.query(`drop database if exists ${db}`);
  await boot.query(`create database ${db}`);
  await boot.end();
  const files = {
    schema: fs.readFileSync(root + '/backend/upstream/schema.sql', 'utf8'),
    r6: fs.readFileSync(root + '/backend/upstream/r6.sql', 'utf8'),
    r7: fs.readFileSync(root + '/backend/upstream/r7.2.sql', 'utf8'),
    r9: fs.readFileSync(root + '/backend/upstream/r9.sql', 'utf8'),
    r9f: fs.readFileSync(root + '/backend/r9f-uncap.sql', 'utf8'),
    hold: fs.readFileSync(root + '/backend/r9h-q2-hold.sql', 'utf8')
  };
  const c = new Client({ ...pgCfg, database: db });
  await c.connect();
  await c.query(`create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$;
    grant authenticated to ubuntu;`);
  await c.query(files.schema);
  await c.query(slice(files.r6, 'create or replace function public.tg_day', 'create or replace function public.tg_limit'));
  await c.query(slice(files.r6, 'create table if not exists public.crop_rules', 'create or replace function public.tg_max_grow_ms'));
  await c.query(slice(files.r9, 'create or replace function public.tg_req_ok', 'create or replace function public.econ_shop_buy'));
  await c.query(slice(files.r7, 'alter table public.saves add column if not exists rev', '-- ======================= H4'));
  await c.query(files.r9f.replace(/notify pgrst, 'reload schema';\s*$/, ''));
  const epoch = (await c.query('select epoch, uncapped from sell_policy where id=1')).rows[0];
  await c.query(files.hold.replace(/notify pgrst, 'reload schema';\s*$/, ''));
  const epochAfter = (await c.query('select epoch, uncapped from sell_policy where id=1')).rows[0];
  await c.query(`grant usage on schema public to authenticated; grant select, insert, update on public.saves to authenticated;`);
  await c.end();
  return { epoch, epochAfter };
}
export async function ensureUser(db, id) {
  const c = new Client({ ...pgCfg, database: db });
  await c.connect();
  await c.query('insert into auth.users(id) values ($1) on conflict do nothing', [id]);
  await c.end();
}
