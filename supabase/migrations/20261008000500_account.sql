-- Foreman — account lifecycle: data export and deletion.

-- Everything the caller is entitled to take with them, as one JSON document:
-- their profile, the boards they can access (with current canvas content),
-- the comments they wrote, and recent activity on boards they can access.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_profile jsonb;
  v_boards jsonb;
  v_comments jsonb;
  v_activity jsonb;
begin
  perform private.enforce_rate_limit('data_export', 5, interval '1 hour');

  select jsonb_build_object(
    'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'username', p.username,
    'email', p.email, 'email_verified', p.email_verified, 'avatar_url', p.avatar_url,
    'avatar_gender_selection', p.avatar_gender_selection, 'plan', p.plan, 'status', p.status,
    'notification_prefs', p.notification_prefs, 'created_at', p.created_at, 'last_login_at', p.last_login_at
  ) into v_profile
  from public.profiles p where p.id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'title', b.title, 'description', b.description, 'role', m.role,
    'access_mode', b.access_mode, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'objects', (
      select coalesce(jsonb_agg(private.object_state(o) order by o.z_index), '[]'::jsonb)
      from public.canvas_objects o where o.board_id = b.id and o.deleted_at is null
    )
  ) order by b.created_at), '[]'::jsonb) into v_boards
  from public.boards b
  join public.board_members m on m.board_id = b.id and m.user_id = v_uid
  where b.deleted_at is null or b.owner_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'board_id', c.board_id, 'object_id', c.object_id, 'body', c.body,
    'created_at', c.created_at, 'edited_at', c.edited_at
  ) order by c.created_at), '[]'::jsonb) into v_comments
  from public.board_comments c
  where c.author_id = v_uid and c.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'board_id', a.board_id, 'type', a.type, 'actor_id', a.actor_id,
    'object_id', a.object_id, 'created_at', a.created_at
  ) order by a.created_at desc), '[]'::jsonb) into v_activity
  from (
    select x.* from public.board_activity x
    join public.board_members m on m.board_id = x.board_id and m.user_id = v_uid
    join public.boards b on b.id = x.board_id and b.deleted_at is null
    order by x.created_at desc
    limit 2000
  ) a;

  perform private.log_security_event('DATA_EXPORTED');

  return jsonb_build_object(
    'format', 'foreman-export-v1',
    'exported_at', now(),
    'profile', v_profile,
    'boards', v_boards,
    'comments', v_comments,
    'activity', v_activity
  );
end;
$$;

-- Soft deletion. The caller must type the confirmation phrase, and must first
-- resolve any board they own that other people are on (transfer ownership or
-- remove the members). The application re-checks the password and signs out
-- every session around this call. Final removal of the auth user is an
-- administrative purge documented in docs/security.md.
create or replace function public.request_account_deletion(p_confirmation text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if p_confirmation is distinct from 'DELETE MY ACCOUNT' then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('account_deletion', 5, interval '1 hour');

  if exists (
    select 1 from public.boards b
    where b.owner_id = v_uid and b.deleted_at is null
      and exists (select 1 from public.board_members m where m.board_id = b.id and m.user_id <> v_uid)
  ) then
    raise exception 'OWNED_BOARDS_REQUIRE_TRANSFER' using errcode = 'P0001';
  end if;

  update public.boards b set deleted_at = now() where b.owner_id = v_uid and b.deleted_at is null;
  delete from public.board_members m where m.user_id = v_uid and m.role <> 'OWNER';
  update public.board_invitations i set status = 'REVOKED', responded_at = now()
    where i.inviter_id = v_uid and i.status = 'PENDING';
  delete from public.board_join_requests r where r.user_id = v_uid and r.status = 'PENDING';

  update public.profiles p set status = 'PENDING_DELETION', deleted_at = now() where p.id = v_uid;
  perform private.log_security_event('ACCOUNT_DELETION_REQUESTED');
end;
$$;
