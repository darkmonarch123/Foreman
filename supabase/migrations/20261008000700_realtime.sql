-- Foreman — Realtime authorization.
--
-- All board channels are PRIVATE Realtime channels, authorised by these
-- policies on realtime.messages. Topics:
--
--   board:<id>:operations   server -> clients   accepted canvas operations
--   board:<id>:comments     server -> clients   comment created/updated/deleted
--   board:<id>:activity     server -> clients   activity notifications
--   board:<id>:presence     clients <-> clients who is connected
--   board:<id>:cursors      clients <-> clients ephemeral cursor positions
--
-- Members (any role) may listen on all five. Clients may only SEND on
-- :presence and :cursors. Operations, comments and activity are emitted by
-- the database functions after the change is persisted (realtime.send), so a
-- client cannot forge them. Cursors and presence are never stored.
--
-- Realtime caches a connection's policy results until its JWT is refreshed,
-- so a removed member can keep listening until their token is replaced. Keep
-- the JWT expiry short (see docs/realtime.md). Writes are unaffected: they
-- are re-authorised on every call.

-- Row Level Security is already enabled on realtime.messages by Supabase.

drop policy if exists "foreman: board members receive" on realtime.messages;
create policy "foreman: board members receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.is_board_member(private.board_id_from_topic((select realtime.topic())))
  );

drop policy if exists "foreman: board members send presence and cursors" on realtime.messages;
create policy "foreman: board members send presence and cursors" on realtime.messages
  for insert to authenticated
  with check (
    private.is_board_member(private.board_id_from_topic((select realtime.topic())))
    and (
      (realtime.messages.extension = 'presence' and (select realtime.topic()) like 'board:%:presence')
      or (realtime.messages.extension = 'broadcast' and (select realtime.topic()) like 'board:%:cursors')
    )
  );
