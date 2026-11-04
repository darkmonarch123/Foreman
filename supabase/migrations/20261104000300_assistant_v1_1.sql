-- Foreman Assistant v1.1: ranking, feedback and template context.
--
-- What this adds, and what it does not change:
--   * Findings carry a usefulness score and a fingerprint (rule + evidence ids,
--     never text) so a run can be ranked and a finding recognised next time.
--   * People can say whether a finding helped, with optional reasons, and hide a
--     type of finding on a board. Feedback is per person, per board, per rule and
--     per finding; it can be changed or removed; every change is audited in an
--     append-only table. Feedback only changes ranking: it never applies, edits
--     or deletes anything on the board.
--   * The Assistant snapshot also returns the board's template (slug and
--     category) and the caller's own feedback summary, so ranking needs no extra
--     round trip.
--   * Acceptance is unchanged: assistant_accept_proposal, the stale checks and
--     the proposal audit trail are not modified.

-- ---------------------------------------------------------------------------
-- proposals: usefulness and fingerprint
-- ---------------------------------------------------------------------------
alter table public.assistant_proposals
  add column usefulness numeric(5, 4) check (usefulness is null or usefulness between 0 and 1),
  add column fingerprint text check (
    fingerprint is null or (char_length(fingerprint) <= 420 and fingerprint ~ '^[a-z_]{3,60}:[0-9a-f,-]+$')
  );

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
    'usefulness', p.usefulness,
    'fingerprint', p.fingerprint,
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

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
create table public.assistant_feedback (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  proposal_id uuid not null references public.assistant_proposals (id) on delete cascade,
  rule_id text,
  fingerprint text,
  helpful boolean not null,
  reasons text[] not null default '{}'
    check (reasons <@ array['irrelevant', 'duplicate', 'wrong_evidence', 'too_obvious', 'wrong_action']::text[]),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_feedback_one_per_finding unique (user_id, proposal_id),
  constraint assistant_feedback_reasons_only_when_unhelpful check (not helpful or cardinality(reasons) = 0)
);

create index assistant_feedback_user_board_idx on public.assistant_feedback (user_id, board_id, rule_id);

-- "Hide this type of finding on this board", per person.
create table public.assistant_hidden_rules (
  user_id uuid not null references public.profiles (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  rule_id text not null check (rule_id ~ '^[a-z_]{3,60}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, board_id, rule_id)
);

-- Append-only history of every feedback change.
create table public.assistant_feedback_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  board_id uuid not null references public.boards (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  proposal_id uuid references public.assistant_proposals (id) on delete set null,
  rule_id text,
  event text not null check (event in ('feedback_set', 'feedback_removed', 'rule_hidden', 'rule_unhidden')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index assistant_feedback_events_board_idx on public.assistant_feedback_events (board_id, created_at desc);
create index assistant_feedback_events_actor_idx on public.assistant_feedback_events (actor_id);

create trigger assistant_feedback_events_no_update
  before update on public.assistant_feedback_events
  for each row execute function private.assistant_events_append_only();

alter table public.assistant_feedback enable row level security;
alter table public.assistant_hidden_rules enable row level security;
alter table public.assistant_feedback_events enable row level security;

revoke all on table public.assistant_feedback from public, anon, authenticated;
revoke all on table public.assistant_hidden_rules from public, anon, authenticated;
revoke all on table public.assistant_feedback_events from public, anon, authenticated;
grant select on public.assistant_feedback to authenticated;
grant select on public.assistant_hidden_rules to authenticated;
grant select on public.assistant_feedback_events to authenticated;

-- Feedback is personal: each person reads only their own, and only while they can see the board.
create policy "assistant_feedback: own rows" on public.assistant_feedback
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_board_member(board_id));
create policy "assistant_hidden_rules: own rows" on public.assistant_hidden_rules
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_board_member(board_id));
create policy "assistant_feedback_events: own rows" on public.assistant_feedback_events
  for select to authenticated
  using (actor_id = (select auth.uid()) and private.is_board_member(board_id));

create or replace function private.assistant_feedback_json(f public.assistant_feedback)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when f.id is null then null else jsonb_build_object(
    'helpful', f.helpful,
    'reasons', to_jsonb(f.reasons),
    'updated_at', f.updated_at
  ) end;
$$;

create or replace function private.assistant_log_feedback(
  p_board_id uuid,
  p_proposal_id uuid,
  p_rule_id text,
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
  insert into public.assistant_feedback_events (board_id, actor_id, proposal_id, rule_id, event, details)
  values (p_board_id, private.require_user(), p_proposal_id, p_rule_id, p_event, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Records (or changes) the caller's feedback on one of their own findings, and
-- optionally hides that type of finding on the board for them. Viewers may give
-- feedback: it changes nothing on the board.
create or replace function public.assistant_set_feedback(
  p_proposal_id uuid,
  p_helpful boolean,
  p_reasons jsonb default '[]'::jsonb,
  p_hide_rule boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_proposal public.assistant_proposals;
  v_row public.assistant_feedback;
  v_reasons text[];
begin
  if p_reasons is not null and (jsonb_typeof(p_reasons) <> 'array' or exists (
    select 1 from jsonb_array_elements(p_reasons) e where jsonb_typeof(e) <> 'string'
  )) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(e), '{}') into v_reasons from jsonb_array_elements_text(coalesce(p_reasons, '[]'::jsonb)) e;
  select p.* into v_proposal from public.assistant_proposals p
    where p.id = p_proposal_id and p.created_by = v_uid;
  if v_proposal.id is null then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_proposal.board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if p_helpful is null
     or cardinality(v_reasons) > 5
     or not (v_reasons <@ array['irrelevant', 'duplicate', 'wrong_evidence', 'too_obvious', 'wrong_action']::text[])
     or (p_helpful and cardinality(v_reasons) > 0)
     or (coalesce(p_hide_rule, false) and v_proposal.rule_id is null) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('assistant_feedback', 120, interval '1 hour');

  select array_agg(distinct r order by r) into v_reasons from unnest(v_reasons) r;
  insert into public.assistant_feedback (board_id, user_id, proposal_id, rule_id, fingerprint, helpful, reasons)
  values (v_proposal.board_id, v_uid, v_proposal.id, v_proposal.rule_id, v_proposal.fingerprint, p_helpful,
          coalesce(v_reasons, '{}'))
  on conflict (user_id, proposal_id) do update
    set helpful = excluded.helpful, reasons = excluded.reasons, updated_at = now()
  returning * into v_row;

  perform private.assistant_log_feedback(v_proposal.board_id, v_proposal.id, v_proposal.rule_id, 'feedback_set',
    jsonb_build_object('helpful', p_helpful, 'reasons', to_jsonb(coalesce(v_reasons, '{}'))));

  if coalesce(p_hide_rule, false) then
    insert into public.assistant_hidden_rules (user_id, board_id, rule_id)
    values (v_uid, v_proposal.board_id, v_proposal.rule_id)
    on conflict do nothing;
    if found then
      perform private.assistant_log_feedback(v_proposal.board_id, v_proposal.id, v_proposal.rule_id, 'rule_hidden');
    end if;
  end if;

  return private.assistant_feedback_json(v_row);
end;
$$;

-- Removes the caller's feedback on one of their findings. Returns true if there was any.
create or replace function public.assistant_clear_feedback(p_proposal_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_row public.assistant_feedback;
begin
  select f.* into v_row from public.assistant_feedback f
    where f.proposal_id = p_proposal_id and f.user_id = v_uid;
  if v_row.id is null then
    if not exists (select 1 from public.assistant_proposals p where p.id = p_proposal_id and p.created_by = v_uid) then
      raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
    end if;
    return false;
  end if;
  perform private.require_board_role(v_row.board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  perform private.enforce_rate_limit('assistant_feedback', 120, interval '1 hour');
  delete from public.assistant_feedback f where f.id = v_row.id;
  perform private.assistant_log_feedback(v_row.board_id, v_row.proposal_id, v_row.rule_id, 'feedback_removed');
  return true;
end;
$$;

-- Shows a hidden type of finding again (or hides one) on a board, for the caller.
create or replace function public.assistant_set_rule_hidden(p_board_id uuid, p_rule_id text, p_hidden boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
begin
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if p_rule_id is null or p_rule_id !~ '^[a-z_]{3,60}$' or p_hidden is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('assistant_feedback', 120, interval '1 hour');
  if p_hidden then
    insert into public.assistant_hidden_rules (user_id, board_id, rule_id) values (v_uid, p_board_id, p_rule_id)
    on conflict do nothing;
    if found then perform private.assistant_log_feedback(p_board_id, null, p_rule_id, 'rule_hidden'); end if;
  else
    delete from public.assistant_hidden_rules h
      where h.user_id = v_uid and h.board_id = p_board_id and h.rule_id = p_rule_id;
    if found then perform private.assistant_log_feedback(p_board_id, null, p_rule_id, 'rule_unhidden'); end if;
  end if;
  return p_hidden;
end;
$$;

-- The caller's feedback on a board, summarised for ranking: hidden rules,
-- helpful / not helpful counts per rule, and fingerprints marked not helpful.
create or replace function private.assistant_feedback_summary(p_board_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'hidden_rules', coalesce((
      select jsonb_agg(h.rule_id order by h.rule_id) from public.assistant_hidden_rules h
      where h.user_id = p_user_id and h.board_id = p_board_id
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_object_agg(x.rule_id, jsonb_build_object('helpful', x.helpful, 'not_helpful', x.not_helpful))
      from (
        select f.rule_id,
               count(*) filter (where f.helpful) as helpful,
               count(*) filter (where not f.helpful) as not_helpful
        from public.assistant_feedback f
        where f.user_id = p_user_id and f.board_id = p_board_id and f.rule_id is not null
        group by f.rule_id
      ) x
    ), '{}'::jsonb),
    'not_helpful', coalesce((
      select jsonb_agg(distinct f.fingerprint) from public.assistant_feedback f
      where f.user_id = p_user_id and f.board_id = p_board_id and not f.helpful and f.fingerprint is not null
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- snapshot: plus updated_at (freshness), template and feedback summary
-- ---------------------------------------------------------------------------
-- Same pre-flight checks, in the same order, as before (20261104000100).
create or replace function public.assistant_board_snapshot(p_board_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role text;
  v_objects jsonb;
  v_comments jsonb;
  v_template jsonb;
begin
  v_uid := private.require_verified_user();
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
      'updated_at', o.updated_at,
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

  select jsonb_build_object('slug', t.slug, 'category', t.category)
  into v_template
  from public.boards b join public.templates t on t.id = b.template_id
  where b.id = p_board_id;

  return jsonb_build_object(
    'role', v_role,
    'objects', v_objects,
    'comments', v_comments,
    'template', v_template,
    'feedback', private.assistant_feedback_summary(p_board_id, v_uid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_run: stores usefulness and fingerprint (otherwise unchanged)
-- ---------------------------------------------------------------------------
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
      if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'confidence') <> 'number'
         or (v_item ? 'usefulness' and jsonb_typeof(v_item -> 'usefulness') not in ('number', 'null')) then
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
        title, explanation, label, severity, confidence, usefulness, fingerprint, evidence, proposal,
        target_object_id, target_object_version
      ) values (
        p_board_id, v_uid, p_context_kind, p_context_object_id, p_action, v_guidance,
        nullif(v_item ->> 'rule_id', ''),
        v_item ->> 'title', v_item ->> 'explanation', v_item ->> 'label', v_item ->> 'severity',
        (v_item ->> 'confidence')::numeric,
        round((v_item ->> 'usefulness')::numeric, 4),
        nullif(v_item ->> 'fingerprint', ''),
        v_evidence, v_proposal,
        v_target, v_target_version
      ) returning * into v_row;

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

-- ---------------------------------------------------------------------------
-- list: plus the caller's feedback on each finding
-- ---------------------------------------------------------------------------
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
    select jsonb_agg(
      private.assistant_proposal_json(x) || jsonb_build_object('feedback', (
        select private.assistant_feedback_json(f) from public.assistant_feedback f
        where f.proposal_id = x.id and f.user_id = v_uid
      ))
      order by x.created_at desc, x.usefulness desc nulls last, x.id)
    from (
      select p.* from public.assistant_proposals p
      where p.board_id = p_board_id and p.created_by = v_uid and p.status in ('pending', 'stale')
      order by p.created_at desc, p.id
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- The caller's hidden rules on a board (for "Show hidden findings").
create or replace function public.assistant_hidden_rules_for(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
begin
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  return coalesce((
    select jsonb_agg(h.rule_id order by h.rule_id) from public.assistant_hidden_rules h
    where h.user_id = v_uid and h.board_id = p_board_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- privileges
-- ---------------------------------------------------------------------------
revoke all on function private.assistant_feedback_json(public.assistant_feedback) from public, anon, authenticated;
revoke all on function private.assistant_log_feedback(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.assistant_feedback_summary(uuid, uuid) from public, anon, authenticated;

revoke all on function public.assistant_set_feedback(uuid, boolean, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.assistant_clear_feedback(uuid) from public, anon, authenticated;
revoke all on function public.assistant_set_rule_hidden(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.assistant_hidden_rules_for(uuid) from public, anon, authenticated;
grant execute on function public.assistant_set_feedback(uuid, boolean, jsonb, boolean) to authenticated;
grant execute on function public.assistant_clear_feedback(uuid) to authenticated;
grant execute on function public.assistant_set_rule_hidden(uuid, text, boolean) to authenticated;
grant execute on function public.assistant_hidden_rules_for(uuid) to authenticated;
