-- Foreman — Foreman Assistant v1.
--
-- The Assistant is a deterministic rule engine that runs in the application's
-- server context. It never writes to the board. This migration adds the audit
-- trail and the only paths by which an accepted proposal can reach the board:
--
--   public.assistant_proposals         one row per finding / proposed change
--   public.assistant_proposal_events   append-only audit trail
--
-- Model (same as the rest of the schema)
--   * RLS is on for both tables. The browser roles get SELECT only, limited to
--     board members. There are no INSERT/UPDATE/DELETE policies or grants:
--     every write goes through a SECURITY DEFINER function below.
--   * Proposals store short excerpts of board text (<= 120 characters) in
--     `evidence`, never whole note or comment bodies.
--   * Accepting a proposal calls public.submit_operation, the same function the
--     board UI uses, so permissions, rate limits, the operation log, activity
--     and Realtime all apply unchanged. The operation id and object id are
--     derived from the proposal id ("assistant:<proposal-id>"), so accepting
--     twice can never create two objects.
--   * `assistant_proposals.status` has no "applied" value. A proposal that has
--     been applied is `accepted` or `edited_accepted` with `applied_operation_id`
--     set, and only assistant_accept_proposal can do that.

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.assistant_proposals (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  context_kind text not null check (context_kind in ('board', 'object')),
  context_object_id uuid,
  action text not null check (action in ('explain_board', 'find_planning_gaps', 'propose_plan')),
  guidance text check (guidance is null or char_length(guidance) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'edited_accepted', 'rejected', 'stale', 'expired')),
  rule_id text check (rule_id is null or rule_id in (
    'unanswered_question', 'action_without_owner', 'vague_note', 'possible_duplicate',
    'disconnected_object', 'overlapping_objects', 'theme_without_decision',
    'open_question_without_next_step'
  )),
  title text not null check (char_length(title) between 1 and 120),
  explanation text not null check (char_length(explanation) between 1 and 500),
  label text not null check (label in ('fact', 'inference', 'suggestion')),
  severity text not null check (severity in ('info', 'warning', 'high')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 10),
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  edited_proposal jsonb check (edited_proposal is null or jsonb_typeof(edited_proposal) = 'object'),
  target_object_id uuid,
  target_object_version integer check (target_object_version is null or target_object_version >= 1),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  applied_operation_id uuid,
  constraint assistant_proposals_object_context check ((context_kind = 'object') = (context_object_id is not null)),
  constraint assistant_proposals_target_pair check ((target_object_id is null) = (target_object_version is null)),
  constraint assistant_proposals_applied_only_when_accepted
    check (applied_operation_id is null or status in ('accepted', 'edited_accepted'))
);

create index assistant_proposals_board_status_idx
  on public.assistant_proposals (board_id, status, created_at desc);
create index assistant_proposals_target_idx
  on public.assistant_proposals (target_object_id, target_object_version);
create index assistant_proposals_creator_idx
  on public.assistant_proposals (created_by, board_id, created_at desc);

create table public.assistant_proposal_events (
  id uuid primary key default gen_random_uuid(),
  -- Strict order of events, whatever the clock resolution.
  seq bigint generated always as identity,
  proposal_id uuid not null references public.assistant_proposals (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  event text not null check (event in (
    'generated', 'viewed', 'edited', 'accepted', 'rejected', 'marked_stale', 'apply_failed', 'applied'
  )),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  -- clock_timestamp(), not now(): several events are written in one transaction
  -- and must keep their order.
  created_at timestamptz not null default clock_timestamp()
);

create index assistant_proposal_events_proposal_idx
  on public.assistant_proposal_events (proposal_id, seq);
create index assistant_proposal_events_board_idx
  on public.assistant_proposal_events (board_id, created_at desc);

-- Events are history. Nothing may rewrite them, not even a function.
create or replace function private.assistant_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ASSISTANT_EVENTS_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

create trigger assistant_proposal_events_no_update
  before update on public.assistant_proposal_events
  for each row execute function private.assistant_events_append_only();

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.assistant_proposals enable row level security;
alter table public.assistant_proposal_events enable row level security;

revoke all on table public.assistant_proposals from public, anon, authenticated;
revoke all on table public.assistant_proposal_events from public, anon, authenticated;
grant select on public.assistant_proposals to authenticated;
grant select on public.assistant_proposal_events to authenticated;

create policy "assistant_proposals: members read" on public.assistant_proposals
  for select to authenticated
  using (private.is_board_member(board_id));

create policy "assistant_proposal_events: members read" on public.assistant_proposal_events
  for select to authenticated
  using (private.is_board_member(board_id));

-- ---------------------------------------------------------------------------
-- helpers (private)
-- ---------------------------------------------------------------------------
-- A stable uuid for "assistant:<proposal-id>:<purpose>". Same input, same id.
create or replace function private.assistant_derived_uuid(p_proposal_id uuid, p_purpose text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5('assistant:' || p_proposal_id::text || ':' || p_purpose)::uuid;
$$;

create or replace function private.assistant_log_event(
  p_proposal_id uuid,
  p_board_id uuid,
  p_event text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.assistant_proposal_events (proposal_id, board_id, actor_id, event, details)
  values (p_proposal_id, p_board_id, private.require_user(), p_event, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function private.assistant_proposal_json(p public.assistant_proposals)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'board_id', p.board_id,
    'context_kind', p.context_kind,
    'context_object_id', p.context_object_id,
    'action', p.action,
    'guidance', p.guidance,
    'status', p.status,
    'rule_id', p.rule_id,
    'title', p.title,
    'explanation', p.explanation,
    'label', p.label,
    'severity', p.severity,
    'confidence', p.confidence,
    'evidence', p.evidence,
    'proposal', p.proposal,
    'edited_proposal', p.edited_proposal,
    'target_object_id', p.target_object_id,
    'target_object_version', p.target_object_version,
    'created_at', p.created_at,
    'resolved_at', p.resolved_at,
    'applied_operation_id', p.applied_operation_id
  );
$$;

-- Validates and rebuilds a proposal from known fields only. The only change
-- v1 allows is creating one new object of a supported type: no updates, no
-- deletions, no images, no drawings.
create or replace function private.assistant_clean_proposal(p_proposal jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_obj jsonb;
  v_type text;
  v_x double precision;
  v_y double precision;
  v_w double precision;
  v_h double precision;
  v_props jsonb;
begin
  if p_proposal is null or jsonb_typeof(p_proposal) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_proposal) <> 'object' or p_proposal ->> 'kind' is distinct from 'create_object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  v_obj := p_proposal -> 'object';
  if jsonb_typeof(v_obj) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_type := v_obj ->> 'type';
  v_x := private.json_number(v_obj, 'x');
  v_y := private.json_number(v_obj, 'y');
  v_w := private.json_number(v_obj, 'width');
  v_h := private.json_number(v_obj, 'height');
  if v_type is null or v_type not in ('STICKY_NOTE', 'TEXT', 'RECTANGLE', 'CIRCLE', 'ARROW')
     or v_x is null or v_y is null or v_w is null or v_h is null
     or v_x not between -1000000 and 1000000 or v_y not between -1000000 and 1000000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if v_type = 'ARROW' then
    if v_w not between -5000 and 5000 or v_h not between -5000 and 5000 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  elsif v_w not between 20 and 2000 or v_h not between 20 and 2000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_props := private.sanitize_props(v_obj -> 'props');
  if char_length(coalesce(v_props ->> 'text', '')) > 200 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'kind', 'create_object',
    'object', jsonb_build_object(
      'type', v_type, 'x', v_x, 'y', v_y, 'width', v_w, 'height', v_h, 'props', v_props
    )
  );
end;
$$;

-- Validates evidence and rebuilds it with only id, version and a short excerpt.
-- Every object must belong to the board.
create or replace function private.assistant_clean_evidence(p_board_id uuid, p_evidence jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
  v_version integer;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) > 10 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_item in select e from jsonb_array_elements(p_evidence) e loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'object_id') <> 'string'
       or jsonb_typeof(v_item -> 'version') <> 'number'
       or jsonb_typeof(v_item -> 'excerpt') <> 'string' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_id := (v_item ->> 'object_id')::uuid;
    v_version := (v_item ->> 'version')::integer;
    if not exists (select 1 from public.canvas_objects c where c.id = v_id and c.board_id = p_board_id) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'object_id', v_id,
      'version', v_version,
      'excerpt', left(regexp_replace(v_item ->> 'excerpt', '[[:cntrl:]]+', ' ', 'g'), 120)
    ));
  end loop;
  return v_out;
end;
$$;

-- The first target or evidence object that was deleted or edited since the
-- proposal was made, as {object_id, reason}; null when everything still matches.
create or replace function private.assistant_stale_reason(p public.assistant_proposals)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'object_id', e.object_id,
    'reason', case when c.id is null or c.deleted_at is not null then 'deleted' else 'changed' end
  )
  from (
    select (x ->> 'object_id')::uuid as object_id, (x ->> 'version')::integer as version
    from jsonb_array_elements(p.evidence) x
    union
    select p.target_object_id, p.target_object_version where p.target_object_id is not null
  ) e
  left join public.canvas_objects c on c.id = e.object_id and c.board_id = p.board_id
  where c.id is null or c.deleted_at is not null or c.version <> e.version
  order by e.object_id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- public functions
-- ---------------------------------------------------------------------------

-- Stores the findings of one analysis run (produced by the rule engine in the
-- application server) and returns them. Any member may run Explain and Find
-- planning gaps; only owners and editors may run Propose a plan. Older pending
-- proposals from the same person on the same board are expired so the queue
-- only ever holds the latest run.
create or replace function public.assistant_create_run(
  p_board_id uuid,
  p_context_kind text,
  p_context_object_id uuid,
  p_action text,
  p_guidance text,
  p_findings jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_role text;
  v_item jsonb;
  v_row public.assistant_proposals;
  v_reason jsonb;
  v_out jsonb := '[]'::jsonb;
  v_evidence jsonb;
  v_proposal jsonb;
  v_target uuid;
  v_target_version integer;
  v_guidance text := nullif(left(btrim(coalesce(p_guidance, '')), 300), '');
begin
  v_role := private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if p_action not in ('explain_board', 'find_planning_gaps', 'propose_plan')
     or p_context_kind not in ('board', 'object')
     or p_findings is null or jsonb_typeof(p_findings) <> 'array' or jsonb_array_length(p_findings) > 10 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_action = 'propose_plan' and v_role = 'VIEWER' then
    raise exception 'BOARD_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if p_context_kind = 'object'
     and (p_context_object_id is null
          or not exists (select 1 from public.canvas_objects c where c.id = p_context_object_id and c.board_id = p_board_id)) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  perform private.enforce_rate_limit('assistant_run', 30, interval '1 hour');
  perform private.enforce_rate_limit('assistant_run:' || p_board_id::text, 10, interval '10 minutes');

  update public.assistant_proposals p
    set status = 'expired', resolved_at = now()
    where p.board_id = p_board_id and p.created_by = v_uid and p.status = 'pending';

  begin
    for v_item in select e from jsonb_array_elements(p_findings) e loop
      if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'confidence') <> 'number' then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      v_evidence := private.assistant_clean_evidence(p_board_id, v_item -> 'evidence');
      v_proposal := private.assistant_clean_proposal(v_item -> 'proposal');
      v_target := nullif(v_item ->> 'target_object_id', '')::uuid;
      v_target_version := nullif(v_item ->> 'target_object_version', '')::integer;
      if v_target is not null and not exists (
        select 1 from public.canvas_objects c where c.id = v_target and c.board_id = p_board_id
      ) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;

      insert into public.assistant_proposals (
        board_id, created_by, context_kind, context_object_id, action, guidance, rule_id,
        title, explanation, label, severity, confidence, evidence, proposal,
        target_object_id, target_object_version
      ) values (
        p_board_id, v_uid, p_context_kind, p_context_object_id, p_action, v_guidance,
        nullif(v_item ->> 'rule_id', ''),
        v_item ->> 'title', v_item ->> 'explanation', v_item ->> 'label', v_item ->> 'severity',
        (v_item ->> 'confidence')::numeric, v_evidence, v_proposal,
        v_target, v_target_version
      ) returning * into v_row;

      -- The board may have moved on between loading it and storing the result.
      v_reason := private.assistant_stale_reason(v_row);
      if v_reason is not null then
        update public.assistant_proposals p
          set status = 'stale', resolved_at = now() where p.id = v_row.id returning * into v_row;
        perform private.assistant_log_event(v_row.id, p_board_id, 'generated',
          jsonb_build_object('rule_id', v_row.rule_id, 'confidence', v_row.confidence, 'action', p_action));
        perform private.assistant_log_event(v_row.id, p_board_id, 'marked_stale', v_reason);
      else
        perform private.assistant_log_event(v_row.id, p_board_id, 'generated',
          jsonb_build_object('rule_id', v_row.rule_id, 'confidence', v_row.confidence, 'action', p_action));
      end if;
      v_out := v_out || jsonb_build_array(private.assistant_proposal_json(v_row));
    end loop;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end;

  return v_out;
end;
$$;

-- The caller's own pending and stale proposals on a board. Pending proposals
-- that have since gone stale or expired are updated first, so what comes back
-- is always current.
create or replace function public.assistant_list_proposals(p_board_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_row public.assistant_proposals;
  v_reason jsonb;
begin
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  for v_row in
    select p.* from public.assistant_proposals p
    where p.board_id = p_board_id and p.created_by = v_uid and p.status = 'pending'
    order by p.created_at
    for update
  loop
    if v_row.created_at < now() - interval '7 days' then
      update public.assistant_proposals p set status = 'expired', resolved_at = now() where p.id = v_row.id;
      continue;
    end if;
    v_reason := private.assistant_stale_reason(v_row);
    if v_reason is not null then
      update public.assistant_proposals p set status = 'stale', resolved_at = now() where p.id = v_row.id;
      perform private.assistant_log_event(v_row.id, p_board_id, 'marked_stale', v_reason);
    end if;
  end loop;

  return coalesce((
    select jsonb_agg(private.assistant_proposal_json(x) order by x.created_at desc, x.id)
    from (
      select p.* from public.assistant_proposals p
      where p.board_id = p_board_id and p.created_by = v_uid and p.status in ('pending', 'stale')
      order by p.created_at desc, p.id
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Records that the person looked at (previewed) a proposal. Once per proposal.
create or replace function public.assistant_mark_viewed(p_proposal_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_p public.assistant_proposals;
begin
  select p.* into v_p from public.assistant_proposals p where p.id = p_proposal_id;
  if v_p.id is null or v_p.created_by <> v_uid then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_p.board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if not exists (
    select 1 from public.assistant_proposal_events e
    where e.proposal_id = v_p.id and e.event = 'viewed' and e.actor_id = v_uid
  ) then
    perform private.assistant_log_event(v_p.id, v_p.board_id, 'viewed');
  end if;
end;
$$;

-- Replaces the proposed object before it is accepted. Owners and editors only,
-- on their own pending proposals. The edit is validated exactly like a new
-- proposal. The status stays `pending`; it becomes `edited_accepted` when accepted.
create or replace function public.assistant_edit_proposal(p_proposal_id uuid, p_proposal jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_p public.assistant_proposals;
  v_clean jsonb;
begin
  select p.* into v_p from public.assistant_proposals p where p.id = p_proposal_id for update;
  if v_p.id is null or v_p.created_by <> v_uid then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_p.board_id, array['OWNER', 'EDITOR']);
  if v_p.status <> 'pending' or v_p.proposal is null then
    raise exception 'PROPOSAL_NOT_PENDING' using errcode = 'P0001';
  end if;
  v_clean := private.assistant_clean_proposal(p_proposal);
  if v_clean is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  update public.assistant_proposals p set edited_proposal = v_clean where p.id = v_p.id returning * into v_p;
  perform private.assistant_log_event(v_p.id, v_p.board_id, 'edited',
    jsonb_build_object('type', v_clean -> 'object' ->> 'type'));
  return private.assistant_proposal_json(v_p);
end;
$$;

create or replace function public.assistant_reject_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_p public.assistant_proposals;
begin
  select p.* into v_p from public.assistant_proposals p where p.id = p_proposal_id for update;
  if v_p.id is null or v_p.created_by <> v_uid then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_p.board_id, array['OWNER', 'EDITOR']);
  if v_p.status = 'rejected' then
    return private.assistant_proposal_json(v_p);
  end if;
  if v_p.status <> 'pending' then
    raise exception 'PROPOSAL_NOT_PENDING' using errcode = 'P0001';
  end if;
  update public.assistant_proposals p set status = 'rejected', resolved_at = now()
    where p.id = v_p.id returning * into v_p;
  perform private.assistant_log_event(v_p.id, v_p.board_id, 'rejected');
  return private.assistant_proposal_json(v_p);
end;
$$;

-- Accepts one proposal and applies it. Everything happens in one transaction
-- while the proposal row is locked:
--   1. the caller must still be an owner or editor of the board
--   2. a proposal that was already applied returns its original result
--   3. a proposal that is no longer pending is reported, never applied
--   4. the target and every evidence object must still be at the version the
--      proposal was made against, otherwise the proposal is marked stale
--   5. the object is created through public.submit_operation
-- Outcomes are returned, not raised, so the audit rows written here commit.
create or replace function public.assistant_accept_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_p public.assistant_proposals;
  v_clean jsonb;
  v_op_id uuid;
  v_obj_id uuid;
  v_result jsonb;
  v_op public.board_operations;
  v_reason jsonb;
  v_code text;
begin
  select p.* into v_p from public.assistant_proposals p where p.id = p_proposal_id for update;
  if v_p.id is null or v_p.created_by <> v_uid then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_p.board_id, array['OWNER', 'EDITOR']);

  if v_p.status in ('accepted', 'edited_accepted') and v_p.applied_operation_id is not null then
    select o.* into v_op from public.board_operations o
      where o.board_id = v_p.board_id and o.operation_id = v_p.applied_operation_id;
    return jsonb_build_object(
      'status', 'already_applied',
      'proposal', private.assistant_proposal_json(v_p),
      'operation', private.operation_json(v_op)
    );
  end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('status', v_p.status, 'proposal', private.assistant_proposal_json(v_p));
  end if;
  if v_p.created_at < now() - interval '7 days' then
    update public.assistant_proposals p set status = 'expired', resolved_at = now()
      where p.id = v_p.id returning * into v_p;
    return jsonb_build_object('status', 'expired', 'proposal', private.assistant_proposal_json(v_p));
  end if;
  if coalesce(v_p.edited_proposal, v_p.proposal) is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  perform private.enforce_rate_limit('assistant_accept', 60, interval '1 hour');

  v_reason := private.assistant_stale_reason(v_p);
  if v_reason is not null then
    update public.assistant_proposals p set status = 'stale', resolved_at = now()
      where p.id = v_p.id returning * into v_p;
    perform private.assistant_log_event(v_p.id, v_p.board_id, 'marked_stale', v_reason);
    return jsonb_build_object(
      'status', 'stale', 'reason', v_reason, 'proposal', private.assistant_proposal_json(v_p)
    );
  end if;

  v_clean := private.assistant_clean_proposal(coalesce(v_p.edited_proposal, v_p.proposal));
  v_op_id := private.assistant_derived_uuid(v_p.id, 'operation');
  v_obj_id := private.assistant_derived_uuid(v_p.id, 'object');

  begin
    v_result := public.submit_operation(
      v_p.board_id, v_op_id, 'OBJECT_CREATED', v_obj_id, v_clean -> 'object', null, null
    );
  exception when others then
    v_code := case when sqlerrm ~ '^[A-Z_]{3,40}$' then sqlerrm else 'UNKNOWN' end;
    perform private.assistant_log_event(v_p.id, v_p.board_id, 'apply_failed', jsonb_build_object('code', v_code));
    return jsonb_build_object(
      'status', 'failed', 'code', v_code, 'proposal', private.assistant_proposal_json(v_p)
    );
  end;

  if v_result ->> 'status' not in ('accepted', 'duplicate') then
    v_code := coalesce(v_result ->> 'code', 'UNKNOWN');
    perform private.assistant_log_event(v_p.id, v_p.board_id, 'apply_failed', jsonb_build_object('code', v_code));
    return jsonb_build_object(
      'status', 'failed', 'code', v_code, 'proposal', private.assistant_proposal_json(v_p)
    );
  end if;

  select o.* into v_op from public.board_operations o
    where o.board_id = v_p.board_id and o.operation_id = v_op_id;

  update public.assistant_proposals p
    set status = case when p.edited_proposal is not null then 'edited_accepted' else 'accepted' end,
        resolved_at = now(),
        applied_operation_id = v_op_id
    where p.id = v_p.id returning * into v_p;

  perform private.assistant_log_event(v_p.id, v_p.board_id, 'accepted',
    jsonb_build_object('edited', v_p.status = 'edited_accepted'));
  perform private.assistant_log_event(v_p.id, v_p.board_id, 'applied',
    jsonb_build_object('operation_id', v_op_id, 'sequence', v_op.board_sequence_number));

  return jsonb_build_object(
    'status', 'applied',
    'proposal', private.assistant_proposal_json(v_p),
    'operation', private.operation_json(v_op)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- pre-flight check, so a refused run costs no board read and no analysis
-- ---------------------------------------------------------------------------
-- True when the caller's next hit on p_action would go over p_max. Reads the
-- counter without changing it; assistant_create_run still counts the run.
create or replace function private.assistant_limit_reached(p_action text, p_max integer, p_window interval)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.rate_limits rl
    where rl.user_id = auth.uid() and rl.action = p_action
      and rl.window_start >= clock_timestamp() - p_window
      and rl.hits >= p_max
  );
$$;

-- Called by the Server Action before it reads any board content. Checks the
-- caller is a verified member, that a viewer is not asking to Propose a plan,
-- and that neither run limit is already used up. Returns the caller's role.
create or replace function public.assistant_check_run(p_board_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
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
  return jsonb_build_object('role', v_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- function privileges: nothing by default, then exactly what the app calls
-- ---------------------------------------------------------------------------
revoke all on function private.assistant_events_append_only() from public, anon, authenticated;
revoke all on function private.assistant_derived_uuid(uuid, text) from public, anon, authenticated;
revoke all on function private.assistant_log_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.assistant_proposal_json(public.assistant_proposals) from public, anon, authenticated;
revoke all on function private.assistant_clean_proposal(jsonb) from public, anon, authenticated;
revoke all on function private.assistant_clean_evidence(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assistant_stale_reason(public.assistant_proposals) from public, anon, authenticated;
revoke all on function private.assistant_limit_reached(text, integer, interval) from public, anon, authenticated;
revoke all on function public.assistant_check_run(uuid, text) from public, anon, authenticated;

revoke all on function public.assistant_create_run(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_list_proposals(uuid, integer) from public, anon, authenticated;
revoke all on function public.assistant_mark_viewed(uuid) from public, anon, authenticated;
revoke all on function public.assistant_edit_proposal(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_reject_proposal(uuid) from public, anon, authenticated;
revoke all on function public.assistant_accept_proposal(uuid) from public, anon, authenticated;

grant execute on function public.assistant_check_run(uuid, text) to authenticated;
grant execute on function public.assistant_create_run(uuid, text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.assistant_list_proposals(uuid, integer) to authenticated;
grant execute on function public.assistant_mark_viewed(uuid) to authenticated;
grant execute on function public.assistant_edit_proposal(uuid, jsonb) to authenticated;
grant execute on function public.assistant_reject_proposal(uuid) to authenticated;
grant execute on function public.assistant_accept_proposal(uuid) to authenticated;
