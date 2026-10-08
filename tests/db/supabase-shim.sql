-- Minimal stand-in for the parts of a Supabase project that the Foreman
-- migrations depend on. TEST ONLY: it lets the real migrations, policies and
-- functions run inside an in-process Postgres so authorization can be tested
-- without a hosted project. It is never applied to a real database.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- auth ----------------------------------------------------------------------
create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- realtime ------------------------------------------------------------------
create schema realtime;

create table realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now()
);

alter table realtime.messages enable row level security;

create function realtime.topic() returns text
language sql stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

-- Same signature as Supabase's realtime.send(payload, event, topic, private).
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language plpgsql
as $$
begin
  insert into realtime.messages (payload, event, topic, private, extension)
  values (payload, event, topic, private, 'broadcast');
end;
$$;

grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;

-- Supabase's default privileges: new objects in `public` are granted to the
-- API roles automatically. Reproduced here so the tests prove the migrations
-- revoke what they should.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
