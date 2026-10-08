-- Foreman — Row Level Security and privileges.
--
-- Model
--   * RLS is enabled on every table.
--   * The browser roles get SELECT only, limited by policy to rows the caller
--     may see. There are no INSERT/UPDATE/DELETE policies: all writes go
--     through the SECURITY DEFINER functions, which check the caller's role.
--   * `anon` can read the published template catalog and check username
--     availability. Nothing else.
--   * No policy uses `using (true)`.

alter table public.profiles enable row level security;
alter table public.templates enable row level security;
alter table public.boards enable row level security;
alter table public.board_sharing enable row level security;
alter table public.board_members enable row level security;
alter table public.board_invitations enable row level security;
alter table public.board_join_requests enable row level security;
alter table public.canvas_objects enable row level security;
alter table public.board_operations enable row level security;
alter table public.board_snapshots enable row level security;
alter table public.board_comments enable row level security;
alter table public.board_activity enable row level security;
alter table public.security_events enable row level security;
alter table public.cookie_consents enable row level security;
alter table public.uploaded_files enable row level security;
alter table private.rate_limits enable row level security;
alter table private.settings enable row level security;

-- ---------------------------------------------------------------------------
-- privileges: start from nothing
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
-- Needed only so policies can call the membership helpers below. `private`
-- must not be added to the API's exposed schemas.
grant usage on schema private to authenticated;
grant execute on function private.is_board_member(uuid) to authenticated;
grant execute on function private.is_board_owner(uuid) to authenticated;
grant execute on function private.own_verified_email() to authenticated;
grant execute on function private.board_id_from_topic(text) to authenticated;

grant select on public.templates to anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.boards to authenticated;
grant select on public.board_sharing to authenticated;
grant select on public.board_members to authenticated;
grant select (id, board_id, inviter_id, invitee_email, role, status, expires_at, created_at, responded_at)
  on public.board_invitations to authenticated;
grant select on public.board_join_requests to authenticated;
grant select on public.canvas_objects to authenticated;
grant select on public.board_operations to authenticated;
grant select on public.board_snapshots to authenticated;
grant select on public.board_comments to authenticated;
grant select on public.board_activity to authenticated;
grant select on public.cookie_consents to authenticated;
grant select on public.uploaded_files to authenticated;

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "templates: read published" on public.templates
  for select to anon, authenticated
  using (is_published);

create policy "boards: members read" on public.boards
  for select to authenticated
  using (
    (deleted_at is null and private.is_board_member(id))
    or owner_id = (select auth.uid())
  );

create policy "board_sharing: owner reads" on public.board_sharing
  for select to authenticated
  using (private.is_board_owner(board_id));

create policy "board_members: members read" on public.board_members
  for select to authenticated
  using (private.is_board_member(board_id));

create policy "board_invitations: owner or invitee reads" on public.board_invitations
  for select to authenticated
  using (
    private.is_board_owner(board_id)
    or invitee_email = (select private.own_verified_email())
  );

create policy "board_join_requests: owner or requester reads" on public.board_join_requests
  for select to authenticated
  using (
    private.is_board_owner(board_id)
    or user_id = (select auth.uid())
  );

create policy "canvas_objects: members read" on public.canvas_objects
  for select to authenticated
  using (private.is_board_member(board_id));

create policy "board_operations: members read" on public.board_operations
  for select to authenticated
  using (private.is_board_member(board_id));

create policy "board_snapshots: members read" on public.board_snapshots
  for select to authenticated
  using (private.is_board_member(board_id));

create policy "board_comments: members read" on public.board_comments
  for select to authenticated
  using (deleted_at is null and private.is_board_member(board_id));

create policy "board_activity: members read" on public.board_activity
  for select to authenticated
  using (private.is_board_member(board_id));

create policy "cookie_consents: read own" on public.cookie_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "uploaded_files: members read" on public.uploaded_files
  for select to authenticated
  using (private.is_board_member(board_id));

-- security_events, private.rate_limits, private.settings: RLS on, no policies.

-- ---------------------------------------------------------------------------
-- function privileges
-- ---------------------------------------------------------------------------
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.normalize_collaboration_code(text) to authenticated;

grant execute on function public.update_profile(text, text, text) to authenticated;
grant execute on function public.regenerate_avatar(text) to authenticated;
grant execute on function public.update_notification_prefs(jsonb) to authenticated;
grant execute on function public.record_cookie_consent(text, boolean, boolean) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.request_account_deletion(text) to authenticated;

grant execute on function public.create_board(text, text, text, text) to authenticated;
grant execute on function public.get_board(uuid) to authenticated;
grant execute on function public.list_boards(text, text, integer, integer) to authenticated;
grant execute on function public.update_board(uuid, text, text) to authenticated;
grant execute on function public.delete_board(uuid) to authenticated;
grant execute on function public.restore_board(uuid) to authenticated;
grant execute on function public.purge_board(uuid) to authenticated;
grant execute on function public.duplicate_board(uuid, text) to authenticated;

grant execute on function public.get_sharing(uuid) to authenticated;
grant execute on function public.update_sharing(uuid, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.regenerate_collaboration_code(uuid) to authenticated;
grant execute on function public.regenerate_share_link(uuid) to authenticated;
grant execute on function public.join_board(text, text) to authenticated;

grant execute on function public.get_board_members(uuid) to authenticated;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

grant execute on function public.create_invitation(uuid, text, text) to authenticated;
grant execute on function public.resend_invitation(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.list_board_invitations(uuid) to authenticated;
grant execute on function public.list_my_invitations() to authenticated;
grant execute on function public.accept_invitation(uuid, text) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;

grant execute on function public.list_join_requests(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean, text) to authenticated;
grant execute on function public.get_notifications() to authenticated;

grant execute on function public.submit_operation(uuid, uuid, text, uuid, jsonb, integer, timestamptz) to authenticated;
grant execute on function public.load_board_state(uuid) to authenticated;
grant execute on function public.get_operations_after(uuid, bigint, integer) to authenticated;

grant execute on function public.add_comment(uuid, text, uuid) to authenticated;
grant execute on function public.update_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.get_board_comments(uuid, timestamptz, integer) to authenticated;
grant execute on function public.get_board_activity(uuid, timestamptz, integer) to authenticated;
grant execute on function public.record_board_export(uuid, text) to authenticated;
