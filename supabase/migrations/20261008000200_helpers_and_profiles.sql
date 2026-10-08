-- Foreman — private helpers, profile lifecycle, account functions.
--
-- Every SECURITY DEFINER function pins `search_path = ''` and derives the
-- acting user from auth.uid(). No function accepts a user id for the actor.
-- Errors are raised with a stable machine-readable code as the message; the
-- application maps codes to human-friendly text.

-- ---------------------------------------------------------------------------
-- text helpers
-- ---------------------------------------------------------------------------
-- Trims every kind of leading/trailing whitespace (btrim alone only removes
-- spaces, which would let a "blank" title or comment made of newlines through).
create or replace function private.trim_ws(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_text, ''), '^\s+|\s+$', '', 'g');
$$;

-- ---------------------------------------------------------------------------
-- identity helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  return v_uid;
end;
$$;

-- Returns the caller's id after checking the account is active and the email
-- address is verified. Used by every collaboration-sensitive function.
create or replace function private.require_verified_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_status text;
  v_verified boolean;
begin
  select p.status, p.email_verified into v_status, v_verified
  from public.profiles p where p.id = v_uid;

  if not found or v_status <> 'ACTIVE' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_verified then
    raise exception 'EMAIL_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  return v_uid;
end;
$$;

create or replace function private.is_board_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.board_members m
    join public.boards b on b.id = m.board_id
    where m.board_id = p_board_id
      and m.user_id = auth.uid()
      and b.deleted_at is null
  );
$$;

create or replace function private.is_board_owner(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id and b.owner_id = auth.uid()
  );
$$;

-- Raises a generic not-found error unless the caller has one of the roles.
-- The same error is used for "does not exist" and "not yours" so private
-- boards are never confirmed to exist.
create or replace function private.require_board_role(p_board_id uuid, p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select m.role into v_role
  from public.board_members m
  join public.boards b on b.id = m.board_id
  where m.board_id = p_board_id and m.user_id = auth.uid() and b.deleted_at is null;

  if v_role is null then
    raise exception 'BOARD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (v_role = any (p_roles)) then
    raise exception 'BOARD_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  return v_role;
end;
$$;

create or replace function private.own_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(p.email) from public.profiles p
  where p.id = auth.uid() and p.email_verified and p.status = 'ACTIVE';
$$;

-- ---------------------------------------------------------------------------
-- randomness and hashing (no extension dependencies)
-- ---------------------------------------------------------------------------
-- gen_random_uuid() draws from the server's cryptographically strong source.
-- 244 random bits per token.
create or replace function private.random_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
$$;

create or replace function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- F-XXX-XXXX from a 32-character alphabet without O/0 and I/1.
create or replace function private.random_collaboration_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  v_out text := '';
  v_i integer;
  -- Offsets that avoid the UUID version/variant bytes (6 and 8 of each UUID).
  c_offsets constant integer[] := array[0, 1, 2, 3, 4, 16, 17];
begin
  for v_i in 1..7 loop
    v_out := v_out || substr(c_alphabet, (get_byte(v_bytes, c_offsets[v_i]) % 32) + 1, 1);
  end loop;
  return 'F-' || substr(v_out, 1, 3) || '-' || substr(v_out, 4, 4);
end;
$$;

create or replace function public.normalize_collaboration_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Strips all whitespace (spaces, tabs, newlines from a paste), then upper-cases.
  select upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- rate limiting (fixed window, per user and action)
-- ---------------------------------------------------------------------------
-- Returns true when the caller is over the limit. The counter update commits
-- with the surrounding statement, so callers that want the attempt recorded
-- must return normally instead of raising.
--
-- `enforce_rate_limit` below raises, which is right for throttling work that
-- succeeds (creating boards, comments, operations): every accepted call is
-- counted. It is NOT enough where FAILED attempts are what must be limited
-- (guessing a code or token): a function that raises afterwards rolls its own
-- increment back. Those functions (`join_board`, `accept_invitation`) call
-- `rate_limit_exceeded` and return a status instead of raising.
create or replace function private.rate_limit_exceeded(p_action text, p_max integer, p_window interval)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_hits integer;
begin
  insert into private.rate_limits as rl (user_id, action, window_start, hits)
  values (v_uid, p_action, clock_timestamp(), 1)
  on conflict (user_id, action) do update
    set hits = case when rl.window_start < clock_timestamp() - p_window then 1 else rl.hits + 1 end,
        window_start = case when rl.window_start < clock_timestamp() - p_window then clock_timestamp() else rl.window_start end
  returning rl.hits into v_hits;

  return v_hits > p_max;
end;
$$;

create or replace function private.enforce_rate_limit(p_action text, p_max integer, p_window interval)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.rate_limit_exceeded(p_action, p_max, p_window) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.log_security_event(p_event_type text, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.security_events (user_id, event_type, metadata)
  values (auth.uid(), p_event_type, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- realtime + activity
-- ---------------------------------------------------------------------------
-- Server-originated broadcast on a private Realtime topic. The message is
-- written inside the caller's transaction, so it is only delivered if the
-- change it describes commits. A Realtime failure must not undo user work.
create or replace function private.broadcast(p_board_id uuid, p_channel text, p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'board:' || p_board_id::text || ':' || p_channel, true);
exception when others then
  raise warning 'foreman: realtime broadcast failed (%): %', p_channel, sqlerrm;
end;
$$;

-- Activity is only ever written here, by the server, for the authenticated
-- actor. Rapid repeats of the same action on the same object by the same
-- person are folded into one row so drags do not flood the feed.
create or replace function private.log_activity(
  p_board_id uuid,
  p_type text,
  p_object_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_coalesce_seconds integer default 0
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_created timestamptz;
begin
  if p_coalesce_seconds > 0 then
    select a.id into v_id
    from public.board_activity a
    where a.board_id = p_board_id
      and a.actor_id = v_actor
      and a.type = p_type
      and a.object_id is not distinct from p_object_id
      and a.created_at > clock_timestamp() - make_interval(secs => p_coalesce_seconds)
    order by a.created_at desc
    limit 1;
  end if;

  if v_id is not null then
    update public.board_activity a
      set created_at = clock_timestamp(),
          metadata = a.metadata || jsonb_build_object('repeat', coalesce((a.metadata ->> 'repeat')::integer, 1) + 1)
      where a.id = v_id
      returning a.created_at into v_created;
  else
    insert into public.board_activity (board_id, actor_id, type, object_id, metadata)
    values (p_board_id, v_actor, p_type, p_object_id, coalesce(p_metadata, '{}'::jsonb))
    returning id, created_at into v_id, v_created;
  end if;

  perform private.broadcast(p_board_id, 'activity', 'activity', jsonb_build_object(
    'id', v_id, 'type', p_type, 'actor_id', v_actor, 'object_id', p_object_id, 'created_at', v_created
  ));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- profile lifecycle
-- ---------------------------------------------------------------------------
create or replace function private.avatar_url(p_gender text, p_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '/api/avatar/' || lower(p_gender) || '/' || p_seed;
$$;

create or replace function private.random_avatar_seed()
returns text
language sql
volatile
set search_path = ''
as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
$$;

-- Creates the profile for a new auth user. Signup metadata is user-supplied,
-- so every field is validated or replaced; the function never fails a signup
-- because of bad metadata and is safe to run twice for the same user.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_first text := left(private.trim_ws(coalesce(v_meta ->> 'first_name', '')), 60);
  v_last text := left(private.trim_ws(coalesce(v_meta ->> 'last_name', '')), 60);
  v_username text := lower(private.trim_ws(coalesce(v_meta ->> 'username', '')));
  v_gender text := upper(private.trim_ws(coalesce(v_meta ->> 'avatar_gender_selection', '')));
  v_seed text := private.random_avatar_seed();
  v_attempt integer := 0;
begin
  if v_first = '' then v_first := 'New'; end if;
  if v_last = '' then v_last := 'Member'; end if;
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    v_username := 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  end if;
  if v_gender not in ('MALE', 'FEMALE') then
    v_gender := case when get_byte(uuid_send(gen_random_uuid()), 0) % 2 = 0 then 'MALE' else 'FEMALE' end;
  end if;

  if exists (select 1 from public.profiles p where p.id = new.id) then
    return new;
  end if;

  loop
    begin
      insert into public.profiles (
        id, first_name, last_name, username, email, email_verified,
        avatar_url, avatar_seed, avatar_style, avatar_gender_selection
      ) values (
        new.id, v_first, v_last, v_username, lower(coalesce(new.email, '')),
        new.email_confirmed_at is not null,
        private.avatar_url(v_gender, v_seed), v_seed, 'portrait', v_gender
      );
      exit;
    exception when unique_violation then
      if exists (select 1 from public.profiles p where p.id = new.id) then
        exit;
      end if;
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        v_username := 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      else
        v_username := left(v_username, 19) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
      end if;
    end;
  end loop;

  return new;
end;
$$;

create or replace function private.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
    set email = lower(coalesce(new.email, p.email)),
        email_verified = new.email_confirmed_at is not null,
        last_login_at = coalesce(new.last_sign_in_at, p.last_login_at)
  where p.id = new.id
    and (
      p.email is distinct from lower(coalesce(new.email, p.email))
      or p.email_verified is distinct from (new.email_confirmed_at is not null)
      or p.last_login_at is distinct from coalesce(new.last_sign_in_at, p.last_login_at)
    );
  return new;
end;
$$;

drop trigger if exists foreman_on_auth_user_created on auth.users;
create trigger foreman_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop trigger if exists foreman_on_auth_user_updated on auth.users;
create trigger foreman_on_auth_user_updated
  after update of email, email_confirmed_at, last_sign_in_at on auth.users
  for each row execute function private.handle_user_updated();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- public profile functions
-- ---------------------------------------------------------------------------
-- Usernames are public handles, so availability is not secret. This is the
-- only function callable before sign-in.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(private.trim_ws(coalesce(p_username, ''))) ~ '^[a-z0-9_]{3,24}$'
    and not exists (
      select 1 from public.profiles p where p.username = lower(private.trim_ws(p_username))
    );
$$;

-- The fields of a profile that its owner may see.
create or replace function private.profile_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'username', p.username,
    'email', p.email, 'email_verified', p.email_verified, 'avatar_url', p.avatar_url,
    'avatar_seed', p.avatar_seed, 'avatar_style', p.avatar_style,
    'avatar_gender_selection', p.avatar_gender_selection, 'plan', p.plan, 'status', p.status,
    'notification_prefs', p.notification_prefs, 'created_at', p.created_at
  );
$$;

create or replace function public.update_profile(p_first_name text, p_last_name text, p_username text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_username text := lower(private.trim_ws(coalesce(p_username, '')));
  v_row public.profiles;
begin
  if char_length(private.trim_ws(coalesce(p_first_name, ''))) not between 1 and 60
     or char_length(private.trim_ws(coalesce(p_last_name, ''))) not between 1 and 60
     or v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  begin
    update public.profiles p
      set first_name = private.trim_ws(p_first_name), last_name = private.trim_ws(p_last_name), username = v_username
      where p.id = v_uid and p.status = 'ACTIVE'
      returning p.* into v_row;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN' using errcode = 'P0001';
  end;

  if v_row.id is null then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  return private.profile_json(v_row);
end;
$$;

-- New seed, optionally switching the initial avatar preference.
create or replace function public.regenerate_avatar(p_gender text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_gender text := upper(private.trim_ws(coalesce(p_gender, '')));
  v_seed text := private.random_avatar_seed();
  v_row public.profiles;
begin
  if v_gender <> '' and v_gender not in ('MALE', 'FEMALE') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('avatar', 30, interval '1 hour');

  update public.profiles p
    set avatar_gender_selection = case when v_gender = '' then p.avatar_gender_selection else v_gender end,
        avatar_seed = v_seed,
        avatar_url = private.avatar_url(case when v_gender = '' then p.avatar_gender_selection else v_gender end, v_seed)
    where p.id = v_uid and p.status = 'ACTIVE'
    returning p.* into v_row;

  if v_row.id is null then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  return private.profile_json(v_row);
end;
$$;

create or replace function public.update_notification_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clean jsonb := '{}'::jsonb;
  v_prefs jsonb;
  v_key text;
begin
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  foreach v_key in array array['invitations', 'join_requests', 'comments', 'product_updates'] loop
    if jsonb_typeof(p_prefs -> v_key) = 'boolean' then
      v_clean := v_clean || jsonb_build_object(v_key, p_prefs -> v_key);
    end if;
  end loop;

  -- Only an active account may write; one that is pending deletion is frozen.
  update public.profiles p set notification_prefs = p.notification_prefs || v_clean
    where p.id = v_uid and p.status = 'ACTIVE'
    returning p.notification_prefs into v_prefs;
  if not found then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  return v_prefs;
end;
$$;

create or replace function public.record_cookie_consent(p_version text, p_analytics boolean, p_preferences boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if char_length(coalesce(p_version, '')) not between 1 and 20 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('cookie_consent', 20, interval '1 hour');
  insert into public.cookie_consents (user_id, consent_version, analytics, preferences)
  values (v_uid, p_version, coalesce(p_analytics, false), coalesce(p_preferences, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- realtime topics
-- ---------------------------------------------------------------------------
-- Board topics are `board:<uuid>:<channel>`. Returns the board id, or null for
-- anything that is not a well-formed board topic (never raises, so a
-- malformed topic simply fails the policy).
create or replace function private.board_id_from_topic(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^board:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(operations|presence|cursors|comments|activity)$'
    then substr(p_topic, 7, 36)::uuid
  end;
$$;
