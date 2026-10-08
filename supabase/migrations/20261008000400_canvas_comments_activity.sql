-- Foreman — canvas operations, snapshots, comments, activity.

-- ---------------------------------------------------------------------------
-- payload validation
-- ---------------------------------------------------------------------------
create or replace function private.json_number(p_json jsonb, p_key text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_json -> p_key) = 'number' then (p_json ->> p_key)::double precision end;
$$;

-- Keeps only known style/content keys with valid values. Anything else in a
-- client payload is dropped, so arbitrary JSON can never be stored on an
-- object or in the operation log (submit_operation stores the accepted
-- fields, not the raw payload). Colors are restricted to #rrggbb or
-- "transparent".
create or replace function private.sanitize_props(p_props jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_num double precision;
begin
  if p_props is null or jsonb_typeof(p_props) <> 'object' then
    return v_out;
  end if;

  if jsonb_typeof(p_props -> 'text') = 'string' then
    if char_length(p_props ->> 'text') > 5000 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('text', p_props ->> 'text');
  end if;

  foreach v_key in array array['fill', 'stroke', 'color'] loop
    if jsonb_typeof(p_props -> v_key) = 'string'
       and ((p_props ->> v_key) ~ '^#[0-9a-fA-F]{6}$' or (p_props ->> v_key) = 'transparent') then
      v_out := v_out || jsonb_build_object(v_key, p_props ->> v_key);
    end if;
  end loop;

  v_num := private.json_number(p_props, 'strokeWidth');
  if v_num is not null and v_num between 0 and 32 then
    v_out := v_out || jsonb_build_object('strokeWidth', v_num);
  end if;
  v_num := private.json_number(p_props, 'fontSize');
  if v_num is not null and v_num between 8 and 200 then
    v_out := v_out || jsonb_build_object('fontSize', v_num);
  end if;

  if (p_props ->> 'textAlign') in ('left', 'center', 'right') and jsonb_typeof(p_props -> 'textAlign') = 'string' then
    v_out := v_out || jsonb_build_object('textAlign', p_props ->> 'textAlign');
  end if;
  if jsonb_typeof(p_props -> 'bold') = 'boolean' then
    v_out := v_out || jsonb_build_object('bold', p_props -> 'bold');
  end if;

  if p_props ? 'points' then
    if jsonb_typeof(p_props -> 'points') <> 'array'
       or jsonb_array_length(p_props -> 'points') > 4000
       or jsonb_array_length(p_props -> 'points') % 2 <> 0
       or exists (
         select 1 from jsonb_array_elements(p_props -> 'points') e
         where jsonb_typeof(e) <> 'number' or (e #>> '{}')::double precision not between -100000 and 100000
       ) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('points', p_props -> 'points');
  end if;

  return v_out;
end;
$$;

create or replace function private.operation_json(o public.board_operations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'operation_id', o.operation_id,
    'sequence', o.board_sequence_number,
    'type', o.operation_type,
    'object_id', o.object_id,
    'actor_id', o.actor_id,
    'object', o.object_state,
    'server_timestamp', o.server_timestamp
  );
$$;

create or replace function private.snapshot_interval()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'snapshot_interval'), 50), 1);
$$;

-- ---------------------------------------------------------------------------
-- submit_operation
-- ---------------------------------------------------------------------------
-- The single write path for the canvas.
--
--   * The actor is auth.uid(); the role is read from board_members. Nothing
--     about identity or permission is taken from the arguments.
--   * The board row is locked, which serialises writers and makes
--     board_sequence_number gap-free and strictly increasing per board.
--   * (board_id, operation_id) is unique: a retried operation returns
--     "duplicate" and changes nothing.
--   * Conflicts are returned (not raised) together with the current server
--     state so the client can reconcile:
--       - position/style/size: last accepted operation wins
--       - a deleted object rejects later moves and updates (deletion wins)
--       - a text change must carry the current version, otherwise it is
--         rejected with the server state
--   * The operation row is written before the Realtime message, in the same
--     transaction, so a broadcast always describes a persisted operation.
--   * board_operations.payload holds only what was ACCEPTED: the validated
--     geometry and the sanitised props. Unknown keys sent by a client are
--     never written anywhere. Clients do not read this column (replay and
--     recovery use object_state through private.operation_json); it is an
--     audit record of the change that was applied.
create or replace function public.submit_operation(
  p_board_id uuid,
  p_operation_id uuid,
  p_type text,
  p_object_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_client_timestamp timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_board public.boards;
  v_existing public.board_operations;
  v_obj public.canvas_objects;
  v_seq bigint;
  v_state jsonb;
  v_type text;
  v_op public.board_operations;
  v_props jsonb := '{}'::jsonb;
  v_accepted jsonb := '{}'::jsonb;
begin
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR']);

  if p_operation_id is null or p_object_id is null
     or p_type is null
     or p_type not in ('OBJECT_CREATED', 'OBJECT_UPDATED', 'OBJECT_MOVED', 'OBJECT_DELETED', 'OBJECT_RESTORED')
     or jsonb_typeof(v_payload) <> 'object'
     or octet_length(v_payload::text) > 65536 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('operation', 600, interval '1 minute');

  select b.* into v_board from public.boards b where b.id = p_board_id for update;

  select o.* into v_existing from public.board_operations o
  where o.board_id = p_board_id and o.operation_id = p_operation_id;
  if v_existing.id is not null then
    select c.* into v_obj from public.canvas_objects c where c.id = v_existing.object_id;
    return jsonb_build_object(
      'status', 'duplicate',
      'sequence', v_existing.board_sequence_number,
      'object', private.object_state(v_obj),
      'last_sequence', v_board.last_sequence
    );
  end if;

  select c.* into v_obj from public.canvas_objects c where c.id = p_object_id for update;
  if v_obj.id is not null and v_obj.board_id <> p_board_id then
    -- Never confirm that an id belongs to someone else's board.
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_seq := v_board.last_sequence + 1;

  begin
    if p_type = 'OBJECT_CREATED' then
      if v_obj.id is not null then
        return jsonb_build_object('status', 'conflict', 'code', 'OBJECT_EXISTS',
          'object', private.object_state(v_obj), 'last_sequence', v_board.last_sequence);
      end if;
      v_type := v_payload ->> 'type';
      if v_type = 'IMAGE' then
        raise exception 'IMAGE_UPLOAD_DISABLED' using errcode = 'P0001';
      end if;
      if v_type is null or v_type not in ('STICKY_NOTE', 'TEXT', 'RECTANGLE', 'CIRCLE', 'ARROW', 'DRAWING')
         or private.json_number(v_payload, 'x') is null or private.json_number(v_payload, 'y') is null
         or private.json_number(v_payload, 'width') is null or private.json_number(v_payload, 'height') is null then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      if (select count(*) from public.canvas_objects c where c.board_id = p_board_id and c.deleted_at is null) >= 5000 then
        raise exception 'BOARD_OBJECT_LIMIT' using errcode = 'P0001';
      end if;

      insert into public.canvas_objects (id, board_id, type, x, y, width, height, rotation, z_index, props, created_by, updated_by)
      values (
        p_object_id, p_board_id, v_type,
        private.json_number(v_payload, 'x'), private.json_number(v_payload, 'y'),
        private.json_number(v_payload, 'width'), private.json_number(v_payload, 'height'),
        coalesce(private.json_number(v_payload, 'rotation'), 0),
        coalesce(
          private.json_number(v_payload, 'z_index')::bigint,
          (select coalesce(max(c.z_index), 0) + 1 from public.canvas_objects c where c.board_id = p_board_id)
        ),
        private.sanitize_props(v_payload -> 'props'),
        v_uid, v_uid
      )
      returning * into v_obj;
      v_accepted := jsonb_build_object(
        'type', v_obj.type, 'x', v_obj.x, 'y', v_obj.y, 'width', v_obj.width, 'height', v_obj.height,
        'rotation', v_obj.rotation, 'z_index', v_obj.z_index, 'props', v_obj.props
      );

    else
      if v_obj.id is null then
        raise exception 'OBJECT_NOT_FOUND' using errcode = 'P0001';
      end if;

      if p_type = 'OBJECT_RESTORED' then
        if v_obj.deleted_at is null then
          return jsonb_build_object('status', 'conflict', 'code', 'OBJECT_NOT_DELETED',
            'object', private.object_state(v_obj), 'last_sequence', v_board.last_sequence);
        end if;
        update public.canvas_objects c
          set deleted_at = null, version = c.version + 1, updated_by = v_uid, updated_at = clock_timestamp()
          where c.id = p_object_id returning * into v_obj;

      elsif v_obj.deleted_at is not null then
        -- Deletion wins over anything that arrives later for the same object.
        return jsonb_build_object('status', 'conflict', 'code', 'OBJECT_DELETED',
          'object', private.object_state(v_obj), 'last_sequence', v_board.last_sequence);

      elsif p_type = 'OBJECT_DELETED' then
        update public.canvas_objects c
          set deleted_at = clock_timestamp(), version = c.version + 1, updated_by = v_uid, updated_at = clock_timestamp()
          where c.id = p_object_id returning * into v_obj;

      elsif p_type = 'OBJECT_MOVED' then
        if private.json_number(v_payload, 'x') is null or private.json_number(v_payload, 'y') is null then
          raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
        end if;
        update public.canvas_objects c
          set x = private.json_number(v_payload, 'x'), y = private.json_number(v_payload, 'y'),
              version = c.version + 1, updated_by = v_uid, updated_at = clock_timestamp()
          where c.id = p_object_id returning * into v_obj;
        v_accepted := jsonb_build_object('x', v_obj.x, 'y', v_obj.y);

      else -- OBJECT_UPDATED
        if jsonb_typeof(v_payload -> 'props') = 'object' and (v_payload -> 'props') ? 'text'
           and p_expected_version is distinct from v_obj.version then
          return jsonb_build_object('status', 'conflict', 'code', 'TEXT_CONFLICT',
            'object', private.object_state(v_obj), 'last_sequence', v_board.last_sequence);
        end if;
        v_props := private.sanitize_props(v_payload -> 'props');
        -- Only the keys the client actually sent, with validated values.
        v_accepted := jsonb_strip_nulls(jsonb_build_object(
          'x', private.json_number(v_payload, 'x'), 'y', private.json_number(v_payload, 'y'),
          'width', private.json_number(v_payload, 'width'), 'height', private.json_number(v_payload, 'height'),
          'rotation', private.json_number(v_payload, 'rotation'),
          'z_index', private.json_number(v_payload, 'z_index')::bigint
        )) || case when v_props = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('props', v_props) end;
        update public.canvas_objects c
          set x = coalesce(private.json_number(v_payload, 'x'), c.x),
              y = coalesce(private.json_number(v_payload, 'y'), c.y),
              width = coalesce(private.json_number(v_payload, 'width'), c.width),
              height = coalesce(private.json_number(v_payload, 'height'), c.height),
              rotation = coalesce(private.json_number(v_payload, 'rotation'), c.rotation),
              z_index = coalesce(private.json_number(v_payload, 'z_index')::bigint, c.z_index),
              props = c.props || v_props,
              version = c.version + 1, updated_by = v_uid, updated_at = clock_timestamp()
          where c.id = p_object_id returning * into v_obj;
      end if;
    end if;
  exception
    when check_violation or numeric_value_out_of_range then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end;

  v_state := private.object_state(v_obj);

  update public.boards b set last_sequence = v_seq, updated_at = now() where b.id = p_board_id;

  insert into public.board_operations (
    board_id, operation_id, actor_id, operation_type, object_id, payload, object_state,
    expected_object_version, resulting_version, client_timestamp, board_sequence_number
  ) values (
    p_board_id, p_operation_id, v_uid, p_type, p_object_id, v_accepted, v_state,
    p_expected_version, v_obj.version, p_client_timestamp, v_seq
  )
  returning * into v_op;

  perform private.log_activity(
    p_board_id, p_type, p_object_id,
    jsonb_build_object('object_type', v_obj.type),
    case when p_type in ('OBJECT_MOVED', 'OBJECT_UPDATED') then 60 else 0 end
  );

  if v_seq % private.snapshot_interval() = 0 then
    perform private.snapshot_board(p_board_id, v_seq);
  end if;

  perform private.broadcast(p_board_id, 'operations', 'operation', private.operation_json(v_op));

  return jsonb_build_object(
    'status', 'accepted', 'sequence', v_seq, 'object', v_state, 'last_sequence', v_seq
  );
end;
$$;

-- Latest snapshot plus every operation accepted after it.
create or replace function public.load_board_state(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot public.board_snapshots;
  v_ops jsonb;
  v_last bigint;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  select s.* into v_snapshot from public.board_snapshots s
  where s.board_id = p_board_id order by s.sequence_number desc limit 1;

  select coalesce(jsonb_agg(private.operation_json(o) order by o.board_sequence_number), '[]'::jsonb) into v_ops
  from public.board_operations o
  where o.board_id = p_board_id and o.board_sequence_number > coalesce(v_snapshot.sequence_number, 0);

  select b.last_sequence into v_last from public.boards b where b.id = p_board_id;

  return jsonb_build_object(
    'board', public.get_board(p_board_id),
    'snapshot', jsonb_build_object(
      'sequence', coalesce(v_snapshot.sequence_number, 0),
      'objects', coalesce(v_snapshot.state -> 'objects', '[]'::jsonb)
    ),
    'operations', v_ops,
    'last_sequence', v_last
  );
end;
$$;

-- Recovery query used after a reconnect or a detected sequence gap.
create or replace function public.get_operations_after(p_board_id uuid, p_after bigint, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_ops jsonb;
  v_last bigint;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  select coalesce(jsonb_agg(private.operation_json(o) order by o.board_sequence_number), '[]'::jsonb) into v_ops
  from (
    select x.* from public.board_operations x
    where x.board_id = p_board_id and x.board_sequence_number > coalesce(p_after, 0)
    order by x.board_sequence_number
    limit v_limit
  ) o;

  select b.last_sequence into v_last from public.boards b where b.id = p_board_id;
  return jsonb_build_object('operations', v_ops, 'last_sequence', v_last);
end;
$$;

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create or replace function private.comment_json(c public.board_comments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'board_id', c.board_id, 'author_id', c.author_id, 'object_id', c.object_id,
    'body', c.body, 'created_at', c.created_at, 'edited_at', c.edited_at,
    'author', (
      select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'avatar_url', p.avatar_url)
      from public.profiles p where p.id = c.author_id
    )
  );
$$;

create or replace function private.require_can_comment(p_board_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  v_role := private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if v_role = 'VIEWER' and not (select b.viewers_can_comment from public.boards b where b.id = p_board_id) then
    raise exception 'COMMENTING_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.add_comment(p_board_id uuid, p_body text, p_object_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_body text := private.trim_ws(coalesce(p_body, ''));
  v_row public.board_comments;
  v_json jsonb;
begin
  perform private.require_can_comment(p_board_id);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_object_id is not null and not exists (
    select 1 from public.canvas_objects o
    where o.id = p_object_id and o.board_id = p_board_id and o.deleted_at is null
  ) then
    raise exception 'OBJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('comment', 60, interval '10 minutes');

  insert into public.board_comments (board_id, author_id, object_id, body)
  values (p_board_id, v_uid, p_object_id, v_body)
  returning * into v_row;

  v_json := private.comment_json(v_row);
  perform private.log_activity(p_board_id, 'COMMENT_CREATED', p_object_id, jsonb_build_object('comment_id', v_row.id));
  perform private.broadcast(p_board_id, 'comments', 'comment', jsonb_build_object('action', 'created', 'comment', v_json));
  return v_json;
end;
$$;

create or replace function public.update_comment(p_comment_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_body text := private.trim_ws(coalesce(p_body, ''));
  v_row public.board_comments;
  v_json jsonb;
begin
  select c.* into v_row from public.board_comments c where c.id = p_comment_id for update;
  if v_row.id is null or v_row.deleted_at is not null or v_row.author_id is distinct from v_uid then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_can_comment(v_row.board_id);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('comment', 60, interval '10 minutes');

  update public.board_comments c set body = v_body, edited_at = now() where c.id = p_comment_id
  returning * into v_row;

  v_json := private.comment_json(v_row);
  perform private.log_activity(v_row.board_id, 'COMMENT_UPDATED', v_row.object_id, jsonb_build_object('comment_id', v_row.id));
  perform private.broadcast(v_row.board_id, 'comments', 'comment', jsonb_build_object('action', 'updated', 'comment', v_json));
  return v_json;
end;
$$;

-- Deleting a comment removes its text. Only the author can do it.
create or replace function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_verified_user();
  v_row public.board_comments;
begin
  select c.* into v_row from public.board_comments c where c.id = p_comment_id for update;
  if v_row.id is null or v_row.deleted_at is not null or v_row.author_id is distinct from v_uid then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.require_board_role(v_row.board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  update public.board_comments c set deleted_at = now(), body = '[deleted]' where c.id = p_comment_id;
  perform private.log_activity(v_row.board_id, 'COMMENT_DELETED', v_row.object_id, jsonb_build_object('comment_id', v_row.id));
  perform private.broadcast(v_row.board_id, 'comments', 'comment',
    jsonb_build_object('action', 'deleted', 'comment', jsonb_build_object('id', v_row.id)));
end;
$$;

create or replace function public.get_board_comments(p_board_id uuid, p_before timestamptz default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_out jsonb;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  select coalesce(jsonb_agg(private.comment_json(c) order by c.created_at desc), '[]'::jsonb) into v_out
  from (
    select x.* from public.board_comments x
    where x.board_id = p_board_id and x.deleted_at is null
      and (p_before is null or x.created_at < p_before)
    order by x.created_at desc
    limit v_limit
  ) c;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- activity
-- ---------------------------------------------------------------------------
create or replace function public.get_board_activity(p_board_id uuid, p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_out jsonb;
begin
  perform private.require_user();
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'type', a.type, 'actor_id', a.actor_id, 'object_id', a.object_id,
    'metadata', a.metadata, 'created_at', a.created_at,
    'actor', (
      select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'avatar_url', p.avatar_url)
      from public.profiles p where p.id = a.actor_id
    ),
    'subject_name', (
      select private.trim_ws(p.first_name || ' ' || p.last_name) from public.profiles p
      where (a.metadata ->> 'user_id') ~ '^[0-9a-f-]{36}$' and p.id = (a.metadata ->> 'user_id')::uuid
    )
  ) order by a.created_at desc), '[]'::jsonb) into v_out
  from (
    select x.* from public.board_activity x
    where x.board_id = p_board_id and (p_before is null or x.created_at < p_before)
    order by x.created_at desc
    limit v_limit
  ) a;
  return v_out;
end;
$$;

-- Called by the client after a PNG has actually been produced.
create or replace function public.record_board_export(p_board_id uuid, p_scope text default 'board')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_verified_user();
  perform private.require_board_role(p_board_id, array['OWNER', 'EDITOR', 'VIEWER']);
  if p_scope is null or p_scope not in ('board', 'viewport') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform private.enforce_rate_limit('export', 30, interval '10 minutes');
  perform private.log_activity(p_board_id, 'BOARD_EXPORTED', null, jsonb_build_object('format', 'png', 'scope', p_scope));
end;
$$;
