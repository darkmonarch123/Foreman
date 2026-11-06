-- Foreman: performance.
--
-- Fewer round trips for the two slowest paths, and indexes for lookups found in
-- the query audit (docs/performance.md). Nothing here changes who can see or do
-- what: both functions run the same permission checks as the functions they
-- replace, as the signed-in user, and the database stays the authority.

-- ---------------------------------------------------------------------------
-- Board page: state and members in one round trip (was two, in sequence).
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: it simply calls the two existing functions as the caller,
-- so their membership checks and errors (BOARD_NOT_FOUND, ...) apply unchanged.
create or replace function public.load_board_page(p_board_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'state', public.load_board_state(p_board_id),
    'members', public.get_board_members(p_board_id)
  );
$$;

revoke all on function public.load_board_page(uuid) from public, anon, authenticated;
grant execute on function public.load_board_page(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assistant: everything the rule engine needs, in one round trip (was three).
-- ---------------------------------------------------------------------------
-- Runs the same pre-flight checks as assistant_check_run, in the same order and
-- before any content is read: verified user, membership, valid action, viewers
-- cannot Propose a plan, run limits not used up. Then it returns only what the
-- rules read: live objects' geometry, version and text (no drawing points or
-- styles), and comment ids with their anchors (never comment text).
create or replace function public.assistant_board_snapshot(p_board_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_objects jsonb;
  v_comments jsonb;
begin
  perform private.require_verified_user();
  v_role := private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if p_action is null or p_action not in ('explain_board', 'find_planning_gaps', 'propose_plan') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_action = 'propose_plan' and v_role = 'VIEWER' then
    raise exception 'BOARD_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if private.assistant_limit_reached('assistant_run', 30, interval '1 hour')
     or private.assistant_limit_reached('assistant_run:' || p_board_id::text, 10, interval '10 minutes') then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'type', o.type,
      'x', o.x,
      'y', o.y,
      'width', o.width,
      'height', o.height,
      'rotation', o.rotation,
      'z_index', o.z_index,
      'version', o.version,
      'props', case when o.props ? 'text' then jsonb_build_object('text', o.props -> 'text') else '{}'::jsonb end
    )), '[]'::jsonb)
  into v_objects
  from (
    select * from public.canvas_objects c
    where c.board_id = p_board_id and c.deleted_at is null
    order by c.z_index
    limit 5000
  ) o;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'object_id', c.object_id)), '[]'::jsonb)
  into v_comments
  from (
    select x.id, x.object_id from public.board_comments x
    where x.board_id = p_board_id and x.deleted_at is null
    limit 2000
  ) c;

  return jsonb_build_object('role', v_role, 'objects', v_objects, 'comments', v_comments);
end;
$$;

revoke all on function public.assistant_board_snapshot(uuid, text) from public, anon, authenticated;
grant execute on function public.assistant_board_snapshot(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes for lookups found in the audit.
-- ---------------------------------------------------------------------------
-- Account data export and account deletion find a person's comments, activity
-- and operations by author/actor; without these they scan every board's rows.
create index if not exists board_comments_author_idx on public.board_comments (author_id);
create index if not exists board_activity_actor_idx on public.board_activity (actor_id);
create index if not exists board_operations_actor_idx on public.board_operations (actor_id);
-- Snapshot and comment anchors: live comments for a board without sorting by time.
create index if not exists board_comments_board_live_idx on public.board_comments (board_id) where deleted_at is null;
-- Proposal listing filters by creator, board and status together.
create index if not exists assistant_proposals_creator_status_idx
  on public.assistant_proposals (created_by, board_id, status, created_at desc);
