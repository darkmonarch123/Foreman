-- Foreman — core schema.
--
-- Conventions
--   * UUID primary keys everywhere.
--   * Enumerations are text columns guarded by check constraints.
--   * Every table in `public` has Row Level Security enabled (see the RLS migration).
--   * Tables are written to only through SECURITY DEFINER functions (see the
--     functions migration); browsers never receive direct write privileges on
--     board data.
--   * `private` holds helpers and bookkeeping that must never be exposed through
--     the Data API. Do not add `private` to the exposed schemas in Supabase.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  username text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  email text not null,
  email_verified boolean not null default false,
  avatar_url text not null check (avatar_url ~ '^/api/avatar/(male|female)/[a-z0-9]{8,32}$'),
  avatar_seed text not null check (avatar_seed ~ '^[a-z0-9]{8,32}$'),
  avatar_style text not null default 'portrait' check (avatar_style in ('portrait')),
  avatar_gender_selection text not null check (avatar_gender_selection in ('MALE', 'FEMALE')),
  plan text not null default 'FREE' check (plan in ('FREE', 'PLUS', 'PRO')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PENDING_DELETION', 'DELETED')),
  notification_prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(notification_prefs) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  deleted_at timestamptz
);

create unique index profiles_username_key on public.profiles (username);
create index profiles_email_idx on public.profiles (lower(email));

comment on table public.profiles is 'One row per auth.users row. Created by a trigger on signup.';
comment on column public.profiles.avatar_gender_selection is
  'Initial avatar-generation preference only. Not an identity attribute.';

-- ---------------------------------------------------------------------------
-- templates (public starter catalog)
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  category text not null check (category in ('PLANNING', 'BRAINSTORMING', 'STUDY', 'PRODUCT', 'ENGINEERING')),
  min_plan text not null default 'FREE' check (min_plan in ('FREE', 'PLUS', 'PRO')),
  is_featured boolean not null default false,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  content jsonb not null default '[]'::jsonb check (jsonb_typeof(content) = 'array'),
  created_at timestamptz not null default now()
);

create index templates_category_idx on public.templates (category, sort_order);

-- ---------------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------------
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (title ~ '\S' and char_length(title) <= 120),
  description text not null default '' check (char_length(description) <= 500),
  access_mode text not null default 'PRIVATE'
    check (access_mode in ('PRIVATE', 'INVITE_ONLY', 'LINK_VIEWER', 'LINK_REQUEST_ACCESS')),
  viewers_can_comment boolean not null default false,
  template_id uuid references public.templates (id) on delete set null,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index boards_owner_idx on public.boards (owner_id);
create index boards_updated_idx on public.boards (updated_at desc);

-- Sharing secrets live apart from `boards` so that ordinary members, who can
-- read the board row, can never read the collaboration code or share link.
create table public.board_sharing (
  board_id uuid primary key references public.boards (id) on delete cascade,
  collaboration_code text not null
    check (collaboration_code ~ '^F-[A-Z0-9]{3}-[A-Z0-9]{4}$'),
  code_enabled boolean not null default true,
  share_link_enabled boolean not null default false,
  share_token_hash text,
  updated_at timestamptz not null default now()
);

create unique index board_sharing_code_key on public.board_sharing (collaboration_code);
create unique index board_sharing_token_key on public.board_sharing (share_token_hash)
  where share_token_hash is not null;

comment on column public.board_sharing.collaboration_code is
  'Human-friendly locator. Never an authorization mechanism on its own.';
comment on column public.board_sharing.share_token_hash is
  'SHA-256 of the share-link token. The raw token is shown once and never stored.';

-- ---------------------------------------------------------------------------
-- membership
-- ---------------------------------------------------------------------------
create table public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('OWNER', 'EDITOR', 'VIEWER')),
  created_at timestamptz not null default now(),
  constraint board_members_board_user_key unique (board_id, user_id)
);

create index board_members_board_idx on public.board_members (board_id);
create index board_members_user_idx on public.board_members (user_id);
-- Exactly one owner per board.
create unique index board_members_single_owner on public.board_members (board_id) where role = 'OWNER';

create table public.board_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  invitee_email text not null check (invitee_email = lower(invitee_email) and char_length(invitee_email) between 3 and 254),
  role text not null check (role in ('EDITOR', 'VIEWER')),
  token_hash text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);

create index board_invitations_board_idx on public.board_invitations (board_id, created_at desc);
create index board_invitations_email_idx on public.board_invitations (invitee_email) where status = 'PENDING';
-- At most one pending invitation per person per board.
create unique index board_invitations_one_pending
  on public.board_invitations (board_id, invitee_email) where status = 'PENDING';

create table public.board_join_requests (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);

create index board_join_requests_board_idx on public.board_join_requests (board_id, created_at desc);
create unique index board_join_requests_one_pending
  on public.board_join_requests (board_id, user_id) where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- canvas
-- ---------------------------------------------------------------------------
create table public.canvas_objects (
  id uuid primary key,
  board_id uuid not null references public.boards (id) on delete cascade,
  type text not null
    check (type in ('STICKY_NOTE', 'TEXT', 'RECTANGLE', 'CIRCLE', 'ARROW', 'DRAWING', 'IMAGE')),
  x double precision not null check (x between -1000000 and 1000000),
  y double precision not null check (y between -1000000 and 1000000),
  width double precision not null check (width between -100000 and 100000),
  height double precision not null check (height between -100000 and 100000),
  rotation double precision not null default 0 check (rotation between -360 and 360),
  z_index bigint not null default 0,
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object'),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index canvas_objects_board_idx on public.canvas_objects (board_id) where deleted_at is null;

create table public.board_operations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  operation_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  operation_type text not null
    check (operation_type in ('OBJECT_CREATED', 'OBJECT_UPDATED', 'OBJECT_MOVED', 'OBJECT_DELETED', 'OBJECT_RESTORED')),
  object_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  object_state jsonb not null,
  expected_object_version integer,
  resulting_version integer not null,
  client_timestamp timestamptz,
  server_timestamp timestamptz not null default clock_timestamp(),
  board_sequence_number bigint not null check (board_sequence_number >= 1),
  constraint board_operations_board_operation_key unique (board_id, operation_id),
  -- Doubles as the (board, sequence) index used by recovery queries.
  constraint board_operations_board_sequence_key unique (board_id, board_sequence_number)
);

create table public.board_snapshots (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  sequence_number bigint not null check (sequence_number >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  constraint board_snapshots_board_sequence_key unique (board_id, sequence_number)
);

-- ---------------------------------------------------------------------------
-- comments and activity
-- ---------------------------------------------------------------------------
create table public.board_comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  object_id uuid references public.canvas_objects (id) on delete set null,
  body text not null check (body ~ '\S' and char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index board_comments_board_created_idx on public.board_comments (board_id, created_at desc);

create table public.board_activity (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type text not null check (type in (
    'BOARD_CREATED', 'BOARD_RENAMED', 'BOARD_DELETED', 'BOARD_RESTORED', 'BOARD_DUPLICATED',
    'MEMBER_INVITED', 'INVITATION_ACCEPTED', 'INVITATION_DECLINED', 'INVITATION_REVOKED',
    'MEMBER_JOINED', 'MEMBER_REMOVED', 'MEMBER_LEFT', 'MEMBER_ROLE_CHANGED', 'OWNERSHIP_TRANSFERRED',
    'JOIN_REQUEST_CREATED', 'JOIN_REQUEST_APPROVED', 'JOIN_REQUEST_REJECTED',
    'SHARING_UPDATED', 'SHARE_LINK_ENABLED', 'SHARE_LINK_DISABLED', 'SHARE_LINK_REGENERATED',
    'COLLABORATION_CODE_REGENERATED',
    'OBJECT_CREATED', 'OBJECT_UPDATED', 'OBJECT_MOVED', 'OBJECT_DELETED', 'OBJECT_RESTORED',
    'COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED',
    'BOARD_EXPORTED', 'TEMPLATE_APPLIED'
  )),
  object_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index board_activity_board_created_idx on public.board_activity (board_id, created_at desc);

-- ---------------------------------------------------------------------------
-- security, consent, uploads
-- ---------------------------------------------------------------------------
-- Security events are kept apart from board activity and are never readable
-- from the browser (RLS enabled, no policies).
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 60),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index security_events_user_idx on public.security_events (user_id, created_at desc);

create table public.cookie_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  consent_version text not null check (char_length(consent_version) between 1 and 20),
  analytics boolean not null default false,
  preferences boolean not null default false,
  created_at timestamptz not null default now()
);

create index cookie_consents_user_idx on public.cookie_consents (user_id, created_at desc);

-- Image uploads are NOT enabled in the application yet. The table exists so
-- the metadata contract is fixed; there is no insert path until secure upload
-- validation ships (see docs/security.md).
create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  storage_key uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index uploaded_files_board_idx on public.uploaded_files (board_id);

-- ---------------------------------------------------------------------------
-- private bookkeeping
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (user_id, action)
);

create table private.settings (
  key text primary key,
  value jsonb not null
);

insert into private.settings (key, value) values
  ('snapshot_interval', '50'::jsonb),
  ('invitation_ttl_days', '7'::jsonb);
