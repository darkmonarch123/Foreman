-- Foreman — boards, sharing, membership, invitations, join requests.

create or replace function private.plan_rank(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'PRO' then 3 when 'PLUS' then 2 else 1 end;
$$;

create or replace function private.object_state(o public.canvas_objects)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'type', o.type,
    'x', o.x,
    'y', o.y,
    'width', o.width,
    'height', o.height,
    'rotation', o.rotation,
    'z_index', o.z_index,
    'props', o.props,
    'version', o.version,
    'deleted', o.deleted_at is not null,
    'created_by', o.created_by,
    'updated_by', o.updated_by,
    'updated_at', o.updated_at
  );
$$;

create or replace function private.snapshot_board(p_board_id uuid, p_sequence bigint)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.board_snapshots (board_id, sequence_number, state)
  select p_board_id, p_sequence, jsonb_build_object(
    'objects',
    coalesce((
      select jsonb_agg(private.object_state(o) order by o.z_index, o.created_at)
      from public.canvas_objects o
      where o.board_id = p_board_id and o.deleted_at is null
    ), '[]'::jsonb)
  )
  on conflict (board_id, sequence_number) do nothing;
$$;

create or replace function private.create_sharing_row(p_board_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_code := private.random_collaboration_code();
    begin
      insert into public.board_sharing (board_id, collaboration_code) values (p_board_id, v_code);
      return v_code;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt >= 10 then
        raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
      end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- board CRUD
-- ---------------------------------------------------------------------------
create or replace function public.create_board(
  p_title text,
  p_description text default '',
  p_access_mode text default 'PRIVATE',
  p_template_slug text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_title text := private.trim_ws(coalesce(p_title, ''));
  v_description text := private.trim_ws(coalesce(p_description, ''));
  v_mode text := coalesce(p_access_mode, 'PRIVATE');
  v_template public.templates;
  v_plan text;
  v_board_id uuid;
  v_code text;
begin
  if char_length(v_title) not between 1 and 120 or char_length(v_description) > 500
     or v_mode not in ('PRIVATE', 'INVITE_ONLY', 'LINK_VIEWER', 'LINK_REQUEST_ACCESS') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('create_board', 30, interval '1 hour');

  if p_template_slug is not null and private.trim_ws(p_template_slug) <> '' then
    select t.* into v_template from public.templates t
    where t.slug = private.trim_ws(p_template_slug) and t.is_published;
    if v_template.id is null then
      raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0001';
    end if;
    select p.plan into v_plan from public.profiles p where p.id = v_uid;
    if private.plan_rank(v_plan) < private.plan_rank(v_template.min_plan) then
      raise exception 'PLAN_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.boards (owner_id, title, description, access_mode, template_id)
  values (v_uid, v_title, v_description, v_mode, v_template.id)
  returning id into v_board_id;

  insert into public.board_members (board_id, user_id, role) values (v_board_id, v_uid, 'OWNER');
  v_code := private.create_sharing_row(v_board_id);

  if v_template.id is not null then
    insert into public.canvas_objects (id, board_id, type, x, y, width, height, rotation, z_index, props, created_by, updated_by)
    select
      gen_random_uuid(), v_board_id, e.item ->> 'type',
      (e.item ->> 'x')::double precision, (e.item ->> 'y')::double precision,
      (e.item ->> 'width')::double precision, (e.item ->> 'height')::double precision,
      coalesce((e.item ->> 'rotation')::double precision, 0),
      e.ordinality,
      private.sanitize_props(coalesce(e.item -> 'props', '{}'::jsonb)),
      v_uid, v_uid
    from jsonb_array_elements(v_template.content) with ordinality as e(item, ordinality)
    where e.item ->> 'type' in ('STICKY_NOTE', 'TEXT', 'RECTANGLE', 'CIRCLE', 'ARROW', 'DRAWING');
  end if;

  perform private.snapshot_board(v_board_id, 0);
  perform private.log_activity(v_board_id, 'BOARD_CREATED');
  if v_template.id is not null then
    perform private.log_activity(v_board_id, 'TEMPLATE_APPLIED', null,
      jsonb_build_object('template', v_template.name));
  end if;

  return jsonb_build_object('id', v_board_id, 'collaboration_code', v_code);
end;
$$;

create or replace function public.get_board(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_out jsonb;
begin
  perform private.require_user();
  v_role := private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  select jsonb_build_object(
    'id', b.id, 'title', b.title, 'description', b.description,
    'access_mode', b.access_mode, 'viewers_can_comment', b.viewers_can_comment,
    'owner_id', b.owner_id, 'last_sequence', b.last_sequence,
    'created_at', b.created_at, 'updated_at', b.updated_at, 'role', v_role
  ) into v_out
  from public.boards b where b.id = p_board_id;
  return v_out;
end;
$$;

-- p_scope: 'all' | 'mine' | 'shared' | 'trash'
create or replace function public.list_boards(
  p_scope text default 'all',
  p_search text default null,
  p_limit integer default 60,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_scope text := coalesce(p_scope, 'all');
  v_search text := nullif(private.trim_ws(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if v_scope not in ('all', 'mine', 'shared', 'trash') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(row_json order by updated_at desc), '[]'::jsonb) into v_out
  from (
    select
      b.updated_at,
      jsonb_build_object(
        'id', b.id, 'title', b.title, 'description', b.description,
        'access_mode', b.access_mode, 'owner_id', b.owner_id, 'role', m.role,
        'created_at', b.created_at, 'updated_at', b.updated_at, 'deleted_at', b.deleted_at,
        'member_count', (select count(*) from public.board_members c where c.board_id = b.id),
        'members', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', x.id, 'first_name', x.first_name, 'last_name', x.last_name, 'avatar_url', x.avatar_url
          )), '[]'::jsonb)
          from (
            select p.id, p.first_name, p.last_name, p.avatar_url
            from public.board_members mm join public.profiles p on p.id = mm.user_id
            where mm.board_id = b.id
            order by (mm.role = 'OWNER') desc, mm.created_at
            limit 5
          ) x
        ),
        'preview', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'type', o.type, 'x', o.x, 'y', o.y, 'width', o.width, 'height', o.height,
            'fill', o.props ->> 'fill', 'stroke', o.props ->> 'stroke'
          )), '[]'::jsonb)
          from (
            select co.* from public.canvas_objects co
            where co.board_id = b.id and co.deleted_at is null and co.type <> 'DRAWING'
            order by co.z_index
            limit 80
          ) o
        )
      ) as row_json
    from public.boards b
    join public.board_members m on m.board_id = b.id and m.user_id = v_uid
    where
      case v_scope
        when 'trash' then b.deleted_at is not null and b.owner_id = v_uid
        when 'mine' then b.deleted_at is null and b.owner_id = v_uid
        when 'shared' then b.deleted_at is null and b.owner_id <> v_uid
        else b.deleted_at is null
      end
      and (v_search is null or position(lower(v_search) in lower(b.title)) > 0)
    order by b.updated_at desc
    limit v_limit offset v_offset
  ) rows;

  return v_out;
end;
$$;

create or replace function public.update_board(p_board_id uuid, p_title text, p_description text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text := private.trim_ws(coalesce(p_title, ''));
  v_old public.boards;
begin
  perform private.require_verified_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  if char_length(v_title) not between 1 and 120
     or (p_description is not null and char_length(private.trim_ws(p_description)) > 500) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select b.* into v_old from public.boards b where b.id = p_board_id for update;

  update public.boards b
    set title = v_title,
        -- NULL means "leave the description alone" (a rename); an explicit
        -- empty string clears it. trim_ws(NULL) is '', so it cannot be used
        -- inside a coalesce here.
        description = case when p_description is null then b.description else private.trim_ws(p_description) end,
        updated_at = now()
    where b.id = p_board_id;

  if v_old.title is distinct from v_title then
    perform private.log_activity(p_board_id, 'BOARD_RENAMED', null, jsonb_build_object('title', v_title));
  end if;
  return public.get_board(p_board_id);
end;
$$;

-- Soft delete: the board moves to the owner's Trash and disappears for
-- everyone else.
create or replace function public.delete_board(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_verified_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  perform private.log_activity(p_board_id, 'BOARD_DELETED');
  update public.boards b set deleted_at = now() where b.id = p_board_id;
end;
$$;

create or replace function public.restore_board(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
begin
  update public.boards b set deleted_at = null, updated_at = now()
  where b.id = p_board_id and b.owner_id = v_uid and b.deleted_at is not null;
  if not found then
    raise exception 'BOARD_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.log_activity(p_board_id, 'BOARD_RESTORED');
end;
$$;

-- Permanent removal. Only possible from Trash, only by the owner.
create or replace function public.purge_board(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
begin
  delete from public.boards b
  where b.id = p_board_id and b.owner_id = v_uid and b.deleted_at is not null;
  if not found then
    raise exception 'BOARD_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.log_security_event('BOARD_PURGED', jsonb_build_object('board_id', p_board_id));
end;
$$;

-- Copies the canvas into a new private board owned by the caller. Members,
-- comments, activity and sharing settings are not copied.
create or replace function public.duplicate_board(p_board_id uuid, p_title text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_source public.boards;
  v_title text;
  v_new_id uuid;
  v_code text;
begin
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR']);
  perform private.enforce_rate_limit('create_board', 30, interval '1 hour');

  select b.* into v_source from public.boards b where b.id = p_board_id;
  v_title := private.trim_ws(coalesce(nullif(private.trim_ws(coalesce(p_title, '')), ''), left(v_source.title, 112) || ' (copy)'));
  if char_length(v_title) not between 1 and 120 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  insert into public.boards (owner_id, title, description, access_mode, template_id)
  values (v_uid, v_title, v_source.description, 'PRIVATE', v_source.template_id)
  returning id into v_new_id;

  insert into public.board_members (board_id, user_id, role) values (v_new_id, v_uid, 'OWNER');
  v_code := private.create_sharing_row(v_new_id);

  insert into public.canvas_objects (id, board_id, type, x, y, width, height, rotation, z_index, props, created_by, updated_by)
  select gen_random_uuid(), v_new_id, o.type, o.x, o.y, o.width, o.height, o.rotation, o.z_index, o.props, v_uid, v_uid
  from public.canvas_objects o
  where o.board_id = p_board_id and o.deleted_at is null and o.type <> 'IMAGE';

  perform private.snapshot_board(v_new_id, 0);
  perform private.log_activity(v_new_id, 'BOARD_CREATED', null, jsonb_build_object('duplicated', true));
  perform private.log_activity(p_board_id, 'BOARD_DUPLICATED');

  return jsonb_build_object('id', v_new_id, 'collaboration_code', v_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- sharing
-- ---------------------------------------------------------------------------
create or replace function public.update_sharing(
  p_board_id uuid,
  p_access_mode text default null,
  p_code_enabled boolean default null,
  p_share_link_enabled boolean default null,
  p_viewers_can_comment boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_board public.boards;
  v_sharing public.board_sharing;
  v_item uuid;
begin
  perform private.require_board_role(p_board_id, array['OWNER']);
  if p_access_mode is not null
     and p_access_mode not in ('PRIVATE', 'INVITE_ONLY', 'LINK_VIEWER', 'LINK_REQUEST_ACCESS') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select b.* into v_board from public.boards b where b.id = p_board_id for update;
  select s.* into v_sharing from public.board_sharing s where s.board_id = p_board_id for update;

  if p_access_mode = 'PRIVATE' and v_board.access_mode <> 'PRIVATE' then
    if exists (select 1 from public.board_members m where m.board_id = p_board_id and m.user_id <> v_uid) then
      raise exception 'BOARD_HAS_MEMBERS' using errcode = 'P0001';
    end if;
    -- Going private withdraws everything that could still let someone in.
    -- Each withdrawal is recorded exactly as the single-item functions
    -- (revoke_invitation, decide_join_request) record it.
    for v_item in
      update public.board_invitations i set status = 'REVOKED', responded_at = now()
        where i.board_id = p_board_id and i.status = 'PENDING'
        returning i.id
    loop
      perform private.log_activity(p_board_id, 'INVITATION_REVOKED', null,
        jsonb_build_object('reason', 'BOARD_MADE_PRIVATE'));
    end loop;
    for v_item in
      update public.board_join_requests r set status = 'REJECTED', decided_at = now(), decided_by = v_uid
        where r.board_id = p_board_id and r.status = 'PENDING'
        returning r.user_id
    loop
      perform private.log_activity(p_board_id, 'JOIN_REQUEST_REJECTED', null,
        jsonb_build_object('user_id', v_item, 'reason', 'BOARD_MADE_PRIVATE'));
    end loop;
  end if;

  if p_share_link_enabled is true and v_sharing.share_token_hash is null then
    raise exception 'SHARE_LINK_NOT_GENERATED' using errcode = 'P0001';
  end if;

  update public.boards b
    set access_mode = coalesce(p_access_mode, b.access_mode),
        viewers_can_comment = coalesce(p_viewers_can_comment, b.viewers_can_comment),
        updated_at = now()
    where b.id = p_board_id;

  update public.board_sharing s
    set code_enabled = coalesce(p_code_enabled, s.code_enabled),
        share_link_enabled = coalesce(p_share_link_enabled, s.share_link_enabled),
        updated_at = now()
    where s.board_id = p_board_id;

  if p_share_link_enabled is not null and p_share_link_enabled is distinct from v_sharing.share_link_enabled then
    perform private.log_activity(p_board_id,
      case when p_share_link_enabled then 'SHARE_LINK_ENABLED' else 'SHARE_LINK_DISABLED' end);
  end if;
  if (p_access_mode is not null and p_access_mode is distinct from v_board.access_mode)
     or (p_code_enabled is not null and p_code_enabled is distinct from v_sharing.code_enabled)
     or (p_viewers_can_comment is not null and p_viewers_can_comment is distinct from v_board.viewers_can_comment) then
    perform private.log_activity(p_board_id, 'SHARING_UPDATED', null, jsonb_build_object(
      'access_mode', coalesce(p_access_mode, v_board.access_mode)
    ));
  end if;

  return public.get_sharing(p_board_id);
end;
$$;

create or replace function public.get_sharing(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  select jsonb_build_object(
    'board_id', b.id,
    'access_mode', b.access_mode,
    'viewers_can_comment', b.viewers_can_comment,
    'collaboration_code', s.collaboration_code,
    'code_enabled', s.code_enabled,
    'share_link_enabled', s.share_link_enabled,
    'share_link_generated', s.share_token_hash is not null
  ) into v_out
  from public.boards b join public.board_sharing s on s.board_id = b.id
  where b.id = p_board_id;
  return v_out;
end;
$$;

create or replace function public.regenerate_collaboration_code(p_board_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  perform private.require_verified_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  perform private.enforce_rate_limit('regenerate_code', 20, interval '1 hour');

  loop
    v_code := private.random_collaboration_code();
    begin
      update public.board_sharing s set collaboration_code = v_code, updated_at = now()
        where s.board_id = p_board_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt >= 10 then
        raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
      end if;
    end;
  end loop;

  perform private.log_activity(p_board_id, 'COLLABORATION_CODE_REGENERATED');
  return v_code;
end;
$$;

-- Creates (or replaces) the share link and enables it. The raw token is
-- returned exactly once; only its hash is stored.
create or replace function public.regenerate_share_link(p_board_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text := private.random_token();
  v_was_enabled boolean;
  v_had_token boolean;
begin
  perform private.require_verified_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  perform private.enforce_rate_limit('regenerate_link', 20, interval '1 hour');

  select s.share_link_enabled, s.share_token_hash is not null into v_was_enabled, v_had_token
  from public.board_sharing s where s.board_id = p_board_id for update;

  update public.board_sharing s
    set share_token_hash = private.hash_token(v_token), share_link_enabled = true, updated_at = now()
    where s.board_id = p_board_id;

  if v_had_token then
    perform private.log_activity(p_board_id, 'SHARE_LINK_REGENERATED');
  end if;
  if not v_was_enabled then
    perform private.log_activity(p_board_id, 'SHARE_LINK_ENABLED');
  end if;
  return v_token;
end;
$$;

-- Resolves a collaboration code or share-link token.
--
-- A code or link is only a locator. What happens next is decided by the
-- board's access mode, and the most a code or link can ever grant is VIEWER.
-- Every failure returns the same UNAVAILABLE status so that a private board
-- is indistinguishable from one that does not exist. Statuses are returned
-- (not raised) so failed attempts stay recorded.
create or replace function public.join_board(p_code text default null, p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_code text := public.normalize_collaboration_code(p_code);
  v_board public.boards;
  v_via text;
begin
  if private.rate_limit_exceeded('join_lookup', 10, interval '10 minutes') then
    perform private.log_security_event('JOIN_RATE_LIMITED');
    return jsonb_build_object('status', 'RATE_LIMITED');
  end if;

  if p_token is not null and char_length(p_token) between 32 and 128 then
    v_via := 'link';
    select b.* into v_board
    from public.board_sharing s join public.boards b on b.id = s.board_id
    where s.share_token_hash = private.hash_token(p_token)
      and s.share_link_enabled and b.deleted_at is null;
  elsif v_code ~ '^F-[A-Z0-9]{3}-[A-Z0-9]{4}$' then
    v_via := 'code';
    select b.* into v_board
    from public.board_sharing s join public.boards b on b.id = s.board_id
    where s.collaboration_code = v_code and s.code_enabled and b.deleted_at is null;
  end if;

  if v_board.id is null then
    perform private.log_security_event('JOIN_LOOKUP_FAILED', jsonb_build_object('via', coalesce(v_via, 'invalid')));
    return jsonb_build_object('status', 'UNAVAILABLE');
  end if;

  if exists (select 1 from public.board_members m where m.board_id = v_board.id and m.user_id = v_uid) then
    return jsonb_build_object('status', 'ALREADY_MEMBER', 'board_id', v_board.id);
  end if;

  if v_board.access_mode = 'LINK_VIEWER' then
    insert into public.board_members (board_id, user_id, role) values (v_board.id, v_uid, 'VIEWER');
    perform private.log_activity(v_board.id, 'MEMBER_JOINED', null, jsonb_build_object('role', 'VIEWER', 'via', v_via));
    return jsonb_build_object('status', 'JOINED_VIEWER', 'board_id', v_board.id);
  end if;

  if v_board.access_mode = 'LINK_REQUEST_ACCESS' then
    if exists (
      select 1 from public.board_join_requests r
      where r.board_id = v_board.id and r.user_id = v_uid and r.status = 'PENDING'
    ) then
      return jsonb_build_object('status', 'PENDING_APPROVAL');
    end if;
    if exists (
      select 1 from public.board_join_requests r
      where r.board_id = v_board.id and r.user_id = v_uid and r.status = 'REJECTED'
        and r.decided_at > now() - interval '7 days'
    ) then
      return jsonb_build_object('status', 'ACCESS_DENIED');
    end if;
    insert into public.board_join_requests (board_id, user_id) values (v_board.id, v_uid);
    perform private.log_activity(v_board.id, 'JOIN_REQUEST_CREATED');
    return jsonb_build_object('status', 'REQUEST_SUBMITTED');
  end if;

  -- PRIVATE and INVITE_ONLY boards cannot be reached with a code or link.
  perform private.log_security_event('JOIN_LOOKUP_FAILED', jsonb_build_object('via', v_via, 'reason', 'mode'));
  return jsonb_build_object('status', 'UNAVAILABLE');
end;
$$;

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
-- Limited profile fields for people on a board. Email addresses are never
-- returned here.
create or replace function public.get_board_members(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id, 'role', m.role, 'first_name', p.first_name, 'last_name', p.last_name,
    'username', p.username, 'avatar_url', p.avatar_url, 'joined_at', m.created_at
  ) order by (m.role = 'OWNER') desc, m.created_at), '[]'::jsonb) into v_out
  from public.board_members m join public.profiles p on p.id = m.user_id
  where m.board_id = p_board_id;
  return v_out;
end;
$$;

create or replace function public.change_member_role(p_board_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_current text;
begin
  perform private.require_board_role(p_board_id, array['OWNER']);
  if p_role not in ('EDITOR', 'VIEWER') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'CANNOT_CHANGE_OWN_ROLE' using errcode = 'P0001';
  end if;

  select m.role into v_current from public.board_members m
  where m.board_id = p_board_id and m.user_id = p_user_id for update;
  if v_current is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_current = 'OWNER' then
    raise exception 'CANNOT_CHANGE_OWNER' using errcode = 'P0001';
  end if;
  if v_current = p_role then
    return;
  end if;

  update public.board_members m set role = p_role where m.board_id = p_board_id and m.user_id = p_user_id;
  perform private.log_activity(p_board_id, 'MEMBER_ROLE_CHANGED', null,
    jsonb_build_object('user_id', p_user_id, 'role', p_role));
  perform private.log_security_event('MEMBER_ROLE_CHANGED',
    jsonb_build_object('board_id', p_board_id, 'user_id', p_user_id, 'role', p_role));
end;
$$;

-- The owner removes someone, or a member leaves. The owner cannot leave.
create or replace function public.remove_member(p_board_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_role text;
  v_target text;
begin
  v_role := private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if p_user_id <> v_uid and v_role <> 'OWNER' then
    raise exception 'BOARD_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select m.role into v_target from public.board_members m
  where m.board_id = p_board_id and m.user_id = p_user_id for update;
  if v_target is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target = 'OWNER' then
    raise exception 'OWNER_CANNOT_LEAVE' using errcode = 'P0001';
  end if;

  -- Log while the actor can still be attributed, then remove.
  perform private.log_activity(p_board_id,
    case when p_user_id = v_uid then 'MEMBER_LEFT' else 'MEMBER_REMOVED' end,
    null, jsonb_build_object('user_id', p_user_id));
  delete from public.board_members m where m.board_id = p_board_id and m.user_id = p_user_id;
end;
$$;

create or replace function public.transfer_ownership(p_board_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
begin
  perform private.require_board_role(p_board_id, array['OWNER']);
  if p_new_owner_id = v_uid then
    return;
  end if;
  if not exists (
    select 1 from public.board_members m join public.profiles p on p.id = m.user_id
    where m.board_id = p_board_id and m.user_id = p_new_owner_id
      and p.status = 'ACTIVE' and p.email_verified
  ) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.board_members m set role = 'EDITOR' where m.board_id = p_board_id and m.user_id = v_uid;
  update public.board_members m set role = 'OWNER' where m.board_id = p_board_id and m.user_id = p_new_owner_id;
  update public.boards b set owner_id = p_new_owner_id, updated_at = now() where b.id = p_board_id;

  perform private.log_activity(p_board_id, 'OWNERSHIP_TRANSFERRED', null,
    jsonb_build_object('user_id', p_new_owner_id));
  perform private.log_security_event('OWNERSHIP_TRANSFERRED',
    jsonb_build_object('board_id', p_board_id, 'user_id', p_new_owner_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create or replace function private.invitation_ttl()
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(days => coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'invitation_ttl_days'), 7));
$$;

create or replace function private.effective_invitation_status(p_status text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_status = 'PENDING' and p_expires_at <= now() then 'EXPIRED' else p_status end;
$$;

-- Owner-only. Invites by email address as EDITOR or VIEWER, never OWNER.
-- The response is identical whether or not an account exists for the email,
-- with one exception: someone who is already a member of THIS board is
-- refused with MEMBER_ALREADY_EXISTS (the owner can already see who is on
-- their board; roles are changed with change_member_role instead).
-- Returns the raw token once so the owner can pass the link on; only the
-- hash is stored. Inviting again renews the existing pending invitation.
-- Inviting to a PRIVATE board moves it to INVITE_ONLY, which is recorded as a
-- SHARING_UPDATED activity.
create or replace function public.create_invitation(p_board_id uuid, p_email text, p_role text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_email text := lower(private.trim_ws(coalesce(p_email, '')));
  v_token text := private.random_token();
  v_expires timestamptz := now() + private.invitation_ttl();
  v_id uuid;
begin
  perform private.require_board_role(p_board_id, array['OWNER']);
  if p_role is null or p_role not in ('EDITOR', 'VIEWER') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if v_email = private.own_verified_email() then
    raise exception 'CANNOT_INVITE_SELF' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.board_members m join public.profiles p on p.id = m.user_id
    where m.board_id = p_board_id and lower(p.email) = v_email
  ) then
    raise exception 'MEMBER_ALREADY_EXISTS' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('invite', 30, interval '1 hour');

  update public.board_invitations i set status = 'EXPIRED'
    where i.board_id = p_board_id and i.status = 'PENDING' and i.expires_at <= now();

  update public.board_invitations i
    set token_hash = private.hash_token(v_token), role = p_role, expires_at = v_expires, inviter_id = v_uid
    where i.board_id = p_board_id and i.invitee_email = v_email and i.status = 'PENDING'
    returning i.id into v_id;

  if v_id is null then
    insert into public.board_invitations (board_id, inviter_id, invitee_email, role, token_hash, expires_at)
    values (p_board_id, v_uid, v_email, p_role, private.hash_token(v_token), v_expires)
    returning id into v_id;
    perform private.log_activity(p_board_id, 'MEMBER_INVITED', null, jsonb_build_object('role', p_role));
  end if;

  -- A private board cannot have invitations, so the first one opens it to
  -- invited people only. That is a sharing change and is recorded as one.
  update public.boards b set access_mode = 'INVITE_ONLY', updated_at = now()
    where b.id = p_board_id and b.access_mode = 'PRIVATE';
  if found then
    perform private.log_activity(p_board_id, 'SHARING_UPDATED', null,
      jsonb_build_object('access_mode', 'INVITE_ONLY', 'reason', 'INVITATION_CREATED'));
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.resend_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.board_invitations;
  v_token text := private.random_token();
  v_expires timestamptz := now() + private.invitation_ttl();
begin
  perform private.require_verified_user();
  select i.* into v_inv from public.board_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is null or not private.is_board_owner(v_inv.board_id) then
    raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_inv.board_id, array['OWNER']);
  if v_inv.status not in ('PENDING', 'EXPIRED') then
    raise exception 'INVITATION_NOT_PENDING' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('invite', 30, interval '1 hour');

  begin
    update public.board_invitations i
      set token_hash = private.hash_token(v_token), expires_at = v_expires, status = 'PENDING', responded_at = null
      where i.id = p_invitation_id;
  exception when unique_violation then
    raise exception 'INVITATION_NOT_PENDING' using errcode = 'P0001';
  end;

  return jsonb_build_object('id', v_inv.id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.board_invitations;
begin
  perform private.require_verified_user();
  select i.* into v_inv from public.board_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is null or not private.is_board_owner(v_inv.board_id) then
    raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_inv.board_id, array['OWNER']);
  if v_inv.status <> 'PENDING' then
    raise exception 'INVITATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  update public.board_invitations i set status = 'REVOKED', responded_at = now() where i.id = p_invitation_id;
  perform private.log_activity(v_inv.board_id, 'INVITATION_REVOKED');
end;
$$;

create or replace function public.list_board_invitations(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'invitee_email', i.invitee_email, 'role', i.role,
    'status', private.effective_invitation_status(i.status, i.expires_at),
    'expires_at', i.expires_at, 'created_at', i.created_at, 'responded_at', i.responded_at
  ) order by i.created_at desc), '[]'::jsonb) into v_out
  from public.board_invitations i where i.board_id = p_board_id;
  return v_out;
end;
$$;

-- Pending invitations addressed to the caller's verified email address.
create or replace function public.list_my_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_out jsonb;
begin
  perform private.require_user();
  v_email := private.own_verified_email();
  if v_email is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'board_id', b.id, 'board_title', b.title, 'role', i.role,
    'inviter_name', private.trim_ws(p.first_name || ' ' || p.last_name), 'inviter_avatar_url', p.avatar_url,
    'expires_at', i.expires_at, 'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb) into v_out
  from public.board_invitations i
  join public.boards b on b.id = i.board_id and b.deleted_at is null
  join public.profiles p on p.id = i.inviter_id
  where i.invitee_email = v_email and i.status = 'PENDING' and i.expires_at > now();
  return v_out;
end;
$$;

-- Accept by id (from the in-app list) or by token (from an invitation link).
-- Either way the invitation must be addressed to the caller's own verified
-- email address: a forwarded link does not grant access to someone else.
--
-- Like join_board, every outcome after the identity checks is RETURNED as a
-- status, never raised:
--   {"status": "ACCEPTED", "board_id": ..., "role": ...}
--   {"status": "INVITATION_UNAVAILABLE" | "INVITATION_EXPIRED" |
--              "INVITATION_REVOKED" | "INVITATION_ALREADY_ACCEPTED" | "RATE_LIMITED"}
-- A raised exception would roll back the rate-limit counter together with
-- everything else, so wrong token guesses would never be counted. Returning
-- keeps each attempt, failed or not, on the caller's counter (30 per 10
-- minutes) and lets failed lookups be written to security_events.
create or replace function public.accept_invitation(p_invitation_id uuid default null, p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_email text := private.own_verified_email();
  v_inv public.board_invitations;
  v_status text;
  v_existing text;
  v_via text := case when p_token is not null then 'token' else 'id' end;
begin
  if private.rate_limit_exceeded('invitation_response', 30, interval '10 minutes') then
    perform private.log_security_event('INVITATION_RATE_LIMITED');
    return jsonb_build_object('status', 'RATE_LIMITED');
  end if;

  if p_token is not null and char_length(p_token) between 32 and 128 then
    select i.* into v_inv from public.board_invitations i
    where i.token_hash = private.hash_token(p_token) for update;
  elsif p_invitation_id is not null then
    select i.* into v_inv from public.board_invitations i where i.id = p_invitation_id for update;
  end if;

  if v_inv.id is null or v_inv.invitee_email is distinct from v_email
     or not exists (select 1 from public.boards b where b.id = v_inv.board_id and b.deleted_at is null) then
    perform private.log_security_event('INVITATION_LOOKUP_FAILED', jsonb_build_object('via', v_via));
    return jsonb_build_object('status', 'INVITATION_UNAVAILABLE');
  end if;

  v_status := private.effective_invitation_status(v_inv.status, v_inv.expires_at);
  if v_status = 'EXPIRED' then
    return jsonb_build_object('status', 'INVITATION_EXPIRED');
  elsif v_status = 'REVOKED' then
    return jsonb_build_object('status', 'INVITATION_REVOKED');
  elsif v_status = 'ACCEPTED' then
    return jsonb_build_object('status', 'INVITATION_ALREADY_ACCEPTED');
  elsif v_status <> 'PENDING' then
    return jsonb_build_object('status', 'INVITATION_UNAVAILABLE');
  end if;

  select m.role into v_existing from public.board_members m
  where m.board_id = v_inv.board_id and m.user_id = v_uid for update;

  if v_existing is null then
    insert into public.board_members (board_id, user_id, role) values (v_inv.board_id, v_uid, v_inv.role);
  elsif v_existing = 'VIEWER' and v_inv.role = 'EDITOR' then
    update public.board_members m set role = 'EDITOR' where m.board_id = v_inv.board_id and m.user_id = v_uid;
  end if;

  update public.board_invitations i
    set status = 'ACCEPTED', responded_at = now(), accepted_by = v_uid
    where i.id = v_inv.id;
  update public.board_join_requests r
    set status = 'APPROVED', decided_at = now(), decided_by = v_inv.inviter_id
    where r.board_id = v_inv.board_id and r.user_id = v_uid and r.status = 'PENDING';

  perform private.log_activity(v_inv.board_id, 'INVITATION_ACCEPTED', null, jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('status', 'ACCEPTED', 'board_id', v_inv.board_id, 'role', v_inv.role);
end;
$$;

create or replace function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_inv public.board_invitations;
begin
  perform private.require_verified_user();
  v_email := private.own_verified_email();
  select i.* into v_inv from public.board_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is null or v_inv.invitee_email is distinct from v_email
     or private.effective_invitation_status(v_inv.status, v_inv.expires_at) <> 'PENDING' then
    raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
  end if;

  update public.board_invitations i set status = 'DECLINED', responded_at = now() where i.id = v_inv.id;
  perform private.log_activity(v_inv.board_id, 'INVITATION_DECLINED');
end;
$$;

-- ---------------------------------------------------------------------------
-- join requests
-- ---------------------------------------------------------------------------
create or replace function public.list_join_requests(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
    'username', p.username, 'avatar_url', p.avatar_url, 'status', r.status, 'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb) into v_out
  from public.board_join_requests r join public.profiles p on p.id = r.user_id
  where r.board_id = p_board_id and r.status = 'PENDING';
  return v_out;
end;
$$;

-- The owner's explicit decision is what grants access; the role is chosen
-- here, never by the person who used the code.
create or replace function public.decide_join_request(p_request_id uuid, p_approve boolean, p_role text default 'VIEWER')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_req public.board_join_requests;
begin
  select r.* into v_req from public.board_join_requests r where r.id = p_request_id for update;
  if v_req.id is null or not private.is_board_owner(v_req.board_id) then
    raise exception 'JOIN_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_req.board_id, array['OWNER']);
  if v_req.status <> 'PENDING' then
    raise exception 'JOIN_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if coalesce(p_approve, false) then
    if p_role is null or p_role not in ('EDITOR', 'VIEWER') then
      raise exception 'INVALID_ROLE' using errcode = 'P0001';
    end if;
    insert into public.board_members (board_id, user_id, role)
    values (v_req.board_id, v_req.user_id, p_role)
    on conflict (board_id, user_id) do nothing;
    update public.board_join_requests r
      set status = 'APPROVED', decided_at = now(), decided_by = v_uid where r.id = v_req.id;
    perform private.log_activity(v_req.board_id, 'JOIN_REQUEST_APPROVED', null,
      jsonb_build_object('user_id', v_req.user_id, 'role', p_role));
  else
    update public.board_join_requests r
      set status = 'REJECTED', decided_at = now(), decided_by = v_uid where r.id = v_req.id;
    perform private.log_activity(v_req.board_id, 'JOIN_REQUEST_REJECTED', null,
      jsonb_build_object('user_id', v_req.user_id));
  end if;
end;
$$;

-- Things waiting on the caller: invitations to them, and join requests on
-- boards they own.
create or replace function public.get_notifications()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_requests jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'board_id', b.id, 'board_title', b.title,
    'requester_name', private.trim_ws(p.first_name || ' ' || p.last_name),
    'requester_avatar_url', p.avatar_url, 'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb) into v_requests
  from public.board_join_requests r
  join public.boards b on b.id = r.board_id and b.deleted_at is null and b.owner_id = v_uid
  join public.profiles p on p.id = r.user_id
  where r.status = 'PENDING';

  return jsonb_build_object('invitations', public.list_my_invitations(), 'join_requests', v_requests);
end;
$$;
