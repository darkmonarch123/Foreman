# Realtime

How live collaboration works in Foreman: which channels exist, who may use them, what travels over them, and how a
canvas edit gets from one browser to the database and on to everyone else.

Related: [Architecture](architecture.md), [Supabase schema and policies](supabase-schema.md),
[Security](security.md), [Testing](testing.md).

## Verification status

| Part                                                                                        | Status                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Channel authorisation policies on `realtime.messages`                                       | **Tested** in `tests/db/realtime.test.ts` by evaluating the policies as each role, against in-process Postgres. |
| `submit_operation`: validation, sequencing, deduplication, conflicts, persist-then-announce | **Tested** in `tests/db/canvas.test.ts`.                                                                        |
| Sync engine: optimistic apply, queue, retry, recovery, gap handling                         | **Tested** against an in-memory transport (unit and browser tests).                                             |
| The Supabase transport in `src/lib/board/supabase-services.ts`                              | **Not run against a real project.** No WebSocket connection to Supabase Realtime has been made.                 |
| Delivery of database-originated broadcasts to clients, presence, cursors, token refresh     | **Not verified.** See [Not yet verified on real Supabase](#not-yet-verified-on-real-supabase).                  |

The database tests insert into a stand-in `realtime.messages` table. They show that the right rows are written
and that the policies allow and deny the right people. They say nothing about whether the Realtime service
delivers those rows.

## Channels

Topics have the form `board:<board uuid>:<channel>`. `private.board_id_from_topic` accepts exactly five channel
names and a lower-case UUID; anything else parses to null and fails every policy.

| Topic                   | Mechanism | Event name  | Origin                            | Direction          | Carries                               |
| ----------------------- | --------- | ----------- | --------------------------------- | ------------------ | ------------------------------------- |
| `board:{id}:operations` | Broadcast | `operation` | Database (`submit_operation`)     | database → clients | Accepted canvas operations            |
| `board:{id}:comments`   | Broadcast | `comment`   | Database (comment functions)      | database → clients | Comment created, updated, deleted     |
| `board:{id}:activity`   | Broadcast | `activity`  | Database (`private.log_activity`) | database → clients | A notification that activity happened |
| `board:{id}:presence`   | Presence  | (presence)  | Clients                           | clients ↔ clients  | Who is connected                      |
| `board:{id}:cursors`    | Broadcast | `cursor`    | Clients                           | clients ↔ clients  | Cursor positions; never stored        |

All five are joined as private channels (`config: { private: true }`). The client opens all five whenever a board
is open, whatever the person's role.

"Database-originated" means a database function calls `realtime.send(payload, event, topic, true)` through
`private.broadcast`, inside the same transaction as the change it describes. These are plain function calls, not
triggers, and Foreman does not use Postgres Changes. `private.broadcast` catches any error from `realtime.send`
and turns it into a warning, so a Realtime problem never rolls back someone's work.

### Payloads

Field names below are the real ones, taken from the SQL that builds them and the client code that parses them.

**`operation`** (built by `private.operation_json`)

```json
{
  "operation_id": "uuid chosen by the submitting client",
  "sequence": 42,
  "type": "OBJECT_CREATED | OBJECT_UPDATED | OBJECT_MOVED | OBJECT_DELETED | OBJECT_RESTORED",
  "object_id": "uuid",
  "actor_id": "uuid of the submitter",
  "object": {
    "id": "uuid",
    "type": "STICKY_NOTE | TEXT | RECTANGLE | CIRCLE | ARROW | DRAWING",
    "x": 0,
    "y": 0,
    "width": 0,
    "height": 0,
    "rotation": 0,
    "z_index": 1,
    "props": {},
    "version": 3,
    "deleted": false,
    "created_by": "uuid",
    "updated_by": "uuid",
    "updated_at": "timestamp"
  },
  "server_timestamp": "timestamp"
}
```

`object` is the **whole object after the operation**, not a diff. Applying an operation on the client means
replacing the stored object with this one.

**`comment`**

```json
{
  "action": "created | updated",
  "comment": {
    "id": "uuid",
    "board_id": "uuid",
    "author_id": "uuid",
    "object_id": "uuid or null",
    "body": "text",
    "created_at": "timestamp",
    "edited_at": "timestamp or null",
    "author": { "first_name": "", "last_name": "", "avatar_url": "" }
  }
}
```

```json
{ "action": "deleted", "comment": { "id": "uuid" } }
```

**`activity`**

```json
{ "id": "uuid", "type": "MEMBER_JOINED", "actor_id": "uuid", "object_id": "uuid or null", "created_at": "timestamp" }
```

The activity broadcast deliberately carries no `metadata` and no names. It is a signal; clients fetch the feed
with `get_board_activity`.

**Presence** state tracked by each client, under the presence key equal to its user id:

```json
{ "user_id": "uuid" }
```

**`cursor`**

```json
{ "user_id": "uuid", "x": 120, "y": -48 }
```

Coordinates are world (canvas) coordinates, rounded to integers before sending.

## Authorisation

### Policies

Supabase Realtime authorises a private channel by evaluating the RLS policies on `realtime.messages` as the
connecting user, with `realtime.topic()` set to the channel's topic. `SELECT` decides whether the client may
receive; `INSERT` decides whether it may send. Migration `20261008000700_realtime.sql` creates one of each, both
for the `authenticated` role only.

| Policy                                             | Command  | Condition                                                                                                                                                                            |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `foreman: board members receive`                   | `SELECT` | `extension` is `broadcast` or `presence`, **and** the caller is a member of the board named in the topic (`private.is_board_member(private.board_id_from_topic(realtime.topic()))`). |
| `foreman: board members send presence and cursors` | `INSERT` | The caller is a member of that board, **and** either `extension = 'presence'` on a `...:presence` topic, or `extension = 'broadcast'` on a `...:cursors` topic.                      |

There are no `UPDATE` or `DELETE` policies.

What follows from that:

| Who                                     | Listen                   | Send                                                             |
| --------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `OWNER`, `EDITOR`, `VIEWER` of a board  | All five topics          | Presence on `:presence`; broadcasts on `:cursors`. Nothing else. |
| Signed-in non-member                    | Nothing                  | Nothing                                                          |
| Anonymous                               | Nothing                  | Nothing                                                          |
| Anyone, on a board that is in Trash     | Nothing (owner included) | Nothing                                                          |
| Anyone, on a malformed or unknown topic | Nothing                  | Nothing                                                          |

- Membership is the only test. Role does not matter for Realtime: viewers may send cursors and presence.
- Clients can never send on `:operations`, `:comments` or `:activity`. Those messages can only come from the
  database functions, which is why they cannot be forged by a member.
- Channels are single-purpose: a client broadcast on `:presence` and a presence message on `:cursors` are both
  refused.
- The `INSERT` policy restricts topic and extension. It does **not** restrict the event name or the payload of a
  client broadcast on `:cursors`. See [Presence and cursors](#presence-and-cursors).

The policy functions (`is_board_member`, `board_id_from_topic`) live in the `private` schema; `authenticated` is
granted `USAGE` on the schema and `EXECUTE` on those functions so that the policies can call them.

### How the client authenticates

`createRealtime().connect()` in `src/lib/board/supabase-services.ts`:

1. Calls `await supabase.realtime.setAuth()` with no argument, which makes the Realtime client use the browser
   Supabase client's current session token.
2. Creates each channel with `{ config: { private: true } }` and subscribes.

The browser client is created by `@supabase/ssr` (`src/lib/supabase/client.ts`) with the anon/publishable key; the
session lives in cookies. Foreman has no code of its own for token refresh on the socket. It relies on
`supabase-js`, which passes a refreshed access token to the Realtime client when the auth state changes. That
behaviour has not been observed against a real project.

### A removed member's listening window

Realtime evaluates the policies when a channel is joined and keeps the result for the connection until its token
is replaced. Removing a member takes effect immediately for everything that goes through the database:
`submit_operation`, comments, `load_board_state` and the rest re-check membership on every call. It does not
immediately close a socket that has already joined. Until that connection's token is refreshed, a removed member
could still receive broadcasts.

What limits this:

- A short access-token lifetime (the README recommends an hour or less). This is a dashboard setting, not
  something the migrations set.
- The honest client leaves on its own: `remove_member` logs `MEMBER_REMOVED`, the removed person's client
  receives that activity event, calls `get_board`, gets `BOARD_NOT_FOUND`, and switches to a "You no longer have
  access to this board" screen. The same happens when the board is moved to Trash (`BOARD_DELETED`). Note that
  this screen replaces the board UI but the page keeps its channels subscribed until the person navigates away.

A modified client would not do that, so the window is real. It applies to listening only.

## Life of a canvas operation

The client half is `BoardEngine` (`src/lib/board/engine.ts`) with the pure state functions in
`src/lib/board/reducer.ts`. The server half is `public.submit_operation`.

```
 Editor A (browser)                    Postgres                       Realtime          Member B (browser)
        |                                 |                              |                      |
        | 1 local edit -> operation       |                              |                      |
        |   {operation_id, type,          |                              |                      |
        |    object_id, payload,          |                              |                      |
        |    expected_version}            |                              |                      |
        | 2 append to pending queue       |                              |                      |
        |   (memory + localStorage)       |                              |                      |
        | 3 redraw: confirmed state       |                              |                      |
        |   + pending ops (optimistic)    |                              |                      |
        |                                 |                              |                      |
        |-- 4 rpc submit_operation ------>|                              |                      |
        |                                 | 5 check caller, role,        |                      |
        |                                 |   payload, rate limit        |                      |
        |                                 |   lock board row             |                      |
        |                                 |   duplicate? return it       |                      |
        |                                 |   conflict?  return it       |                      |
        |                                 |   apply to canvas_objects    |                      |
        |                                 |   sequence = last + 1        |                      |
        |                                 |   insert board_operations    |                      |
        |                                 |   log activity, snapshot     |                      |
        |                                 |-- 6 realtime.send ---------->|                      |
        |                                 |   (same transaction)         |                      |
        |                                 |   commit                     |                      |
        |<- 7 {status, sequence, object} -|                              |                      |
        |   remove from pending queue     |                              |                      |
        |   store server object           |                              |                      |
        |                                 |                              |-- 8 "operation" ---->|
        |<----------------------------------------- 8 "operation" -------|   validate payload   |
        |   sequence <= last: ignore      |                              |   next in sequence:  |
        |                                 |                              |     apply            |
        |                                 |                              |   gap: buffer, then  |
        |                                 |                              |     catch-up query   |
```

### 1 to 3: optimistic apply and the pending queue

- Every local edit becomes a `PendingOperation`: `operation_id` (a new `crypto.randomUUID()`), `type`,
  `object_id`, `payload`, `expected_version` and `client_timestamp`. For a new object the client also chooses the
  object id.
- `expected_version` is the version of the object as the person saw it, including the effect of their own earlier
  unsent edits (each pending operation bumps the version locally by one, as the server will).
- The engine keeps two things apart: the **confirmed document** (objects and `lastSequence`, only ever changed by
  what the server said) and the **pending queue**. What is drawn is the confirmed document with the pending
  operations replayed on top (`projectView`). When a remote change arrives, the pending operations are simply
  replayed over the new base.
- The queue is written to `localStorage` on every change, under the key

  ```
  foreman:pending:v1:<userId>:<boardId>
  ```

  as a JSON array of pending operations. The key is removed when the queue is empty. Only unsent operations are
  stored; the board itself is never cached in the browser. At most the first 500 operations are persisted; beyond
  that the queue still works but the excess exists only in memory. On load, entries that do not look like a
  pending operation are discarded. If storage is full or blocked the queue lives in memory for that tab.

- Viewers have no queue: the engine refuses local edits and does not load stored operations when `canEdit` is
  false.
- While the queue is not empty the page registers a `beforeunload` handler, so the browser warns before the tab
  is closed.

Because the queue holds payloads, text that has been typed but not yet acknowledged sits in `localStorage` until
it is acknowledged or the person explicitly discards unsent changes.

### 4: submit

Operations are sent one at a time, oldest first, through the `submit_operation` RPC with `p_board_id`,
`p_operation_id`, `p_type`, `p_object_id`, `p_payload`, `p_expected_version` and `p_client_timestamp`. No user id
and no role are sent; the database reads the caller from the session token.

### 5 and 6: server validation, sequence, persist, broadcast

Described step by step in
[Supabase schema: operation sequencing and conflicts](supabase-schema.md#operation-sequencing-and-conflicts). The
points that matter here:

- The board row is locked, so sequence numbers are strictly increasing and gap-free per board.
- `(board_id, operation_id)` is unique. A resubmitted operation returns `status: "duplicate"` and is neither
  applied nor broadcast again.
- A conflict is returned, not raised, with the current server state of the object. It consumes no sequence
  number and is not broadcast.
- The `board_operations` row is inserted before `realtime.send` is called, in the same transaction. A broadcast
  therefore always describes a persisted operation, and nothing is broadcast for a rejected one.
- An accepted operation produces **two** messages: `activity` on `:activity` (from the activity log) and then
  `operation` on `:operations`.

### 7: acknowledgement and reconciliation

The RPC result is the acknowledgement, and it is the only thing that removes an operation from the queue.

| Result                                                                                                                               | What the engine does                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted` or `duplicate`                                                                                                            | Removes the operation from the queue and stores `result.object` (unless it already holds a newer version). If `result.sequence` is exactly `lastSequence + 1` it advances; if it is further ahead, other people's operations were sequenced first and have not arrived, so it starts recovery. |
| `conflict`                                                                                                                           | Removes the operation, stores the server's object (so the screen shows the server's version), blocks undo/redo entries for that object and shows a notice. Codes: `TEXT_CONFLICT`, `OBJECT_DELETED`, `OBJECT_EXISTS`, `OBJECT_NOT_DELETED`.                                                    |
| Error that may pass (`NETWORK`, `UNKNOWN`, `RATE_LIMITED`, `NOT_CONFIGURED`)                                                         | Keeps the operation at the head of the queue and schedules a retry with backoff.                                                                                                                                                                                                               |
| Error that blocks everything (`UNAUTHENTICATED`, `BOARD_NOT_FOUND`, `BOARD_ACCESS_DENIED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_INACTIVE`) | Stops sending, keeps the queue, sets status `failed`. Nothing more is sent until `retry()` is called.                                                                                                                                                                                          |
| Any other error (for example `VALIDATION_FAILED`, `OBJECT_NOT_FOUND`, `BOARD_OBJECT_LIMIT`)                                          | Drops that operation, removes its undo history, shows a "rejected" notice, and carries on with the next one.                                                                                                                                                                                   |

### 8: delivery to everyone, including the sender

Each incoming `operation` payload is validated (see [Limits and validation](#limits-and-validation)) and handed to
`engine.receive`:

- `sequence <= lastSequence`: already reflected, ignored. This is what normally happens to the sender's own
  broadcast when the acknowledgement arrived first.
- `sequence == lastSequence + 1`: applied; then any buffered operations that now follow on are applied too.
- `sequence > lastSequence + 1`: a gap. The operation is buffered and recovery starts.

Objects are stored with a version check: an incoming object never replaces a newer version already held. That
makes application idempotent and safe when an acknowledgement and a broadcast race each other.

An operation by someone else also marks the current user's undo/redo entries for that object as blocked, so undo
never silently reverses another person's change. Undo and redo are themselves ordinary new operations.

## Presence and cursors

### What is tracked

- **Presence.** When the `:presence` channel is joined the client calls `track({ user_id })`, with the presence
  key set to its user id. On every presence `sync` it reads the full state and collects the `user_id` values that
  are well-formed UUIDs.
- **Cursors.** Pointer movement over the canvas calls `sendCursor(x, y)`, which broadcasts `cursor` on `:cursors`
  with `self: false` (the sender does not receive its own cursor).

Neither is written to any table by Foreman's SQL. No function reads or stores a cursor or presence payload.

### Throttling and clean-up

| What                                     | Value                                                                      | Where                           |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| Outgoing cursor rate                     | At most one message per 80 ms, with a trailing send of the latest position | `CURSOR_INTERVAL_MS`, client    |
| Outgoing cursors while the tab is hidden | Not sent                                                                   | `document.hidden` check, client |
| Incoming cursor budget                   | At most 30 events per sender per second; the rest are dropped              | client                          |
| Cursor time-to-live                      | Removed if not updated for 8 seconds                                       | `CURSOR_TTL_MS`, client         |
| Cursor sweep                             | Every 2 seconds                                                            | client                          |

Stale presence is handled in two ways. Foreman does not time presence out itself: it relies on Supabase Presence
to drop a connection's entry when that connection goes away, and it recomputes the online set from scratch on
every `sync`. When the online set changes, cursors of people no longer in it are removed at once; a cursor that
simply stops moving disappears after the 8-second TTL. On leaving the board page the client removes all five
channels.

### Known limitation: identity is asserted by the client

The `user_id` in a presence entry and in a cursor message is written by the sending client. The database policy
checks that the _sender_ is a member of the board; it cannot check that the `user_id` inside the payload is the
sender's own. So one member can make another member appear online, or draw a cursor in another member's name.

What the client does to contain this, exactly:

1. Only board members can join `:presence` and `:cursors` at all (policy).
2. Presence ids are intersected with the member list returned by `get_board_members`, which the database
   authorises. An id that is not a member is never shown. The current user is always shown as online.
3. A cursor is drawn only if its `user_id` is in that filtered online set **and** resolves to a member; the name
   shown comes from the member list, never from the payload.
4. Cursor payloads must pass `parseCursor`: a UUID `user_id` and finite numeric `x`, `y` within ±1,000,000.
   Messages carrying the current user's own id are ignored.

The member list itself is re-read from the database when a membership activity event arrives (see
[Comment and activity events](#comment-and-activity-events)). Presence ids are filtered against the list the
client holds at the moment of each presence `sync`, so someone whose presence arrives before the refreshed list
does is not shown until the next `sync`.

What this does not prevent: a member impersonating _another member_ in presence or cursors, or a member sending
other event names or large payloads on `:cursors` (receivers ignore unknown events and invalid payloads, but the
database policy does not stop them being sent). Canvas operations, comments and activity are not affected,
because clients cannot send on those topics and every write is attributed from the session token. Server-verified
presence is listed as future work in the README.

## Reconnect and recovery

### Triggers

Recovery (`engine.resync()` or `recover()`) starts when any of these happens:

- the browser fires `online` after having been offline;
- the Realtime status goes from not-connected to connected (all five channels joined);
- a retry timer fires after a failed submit or a failed recovery;
- a broadcast arrives with a sequence gap;
- an acknowledgement carries a sequence more than one ahead of the confirmed document;
- the person presses retry after a blocking failure.

The first time a board is opened counts too. The page is rendered from `load_board_state` on the server, and the
channels join afterwards. As the channels come up one by one the client reports "not connected" until the fifth
has joined, then "connected", and that transition runs the catch-up query. Operations accepted between the server
render and the join are fetched then.

### Procedure

1. **Catch up.** Call `get_operations_after(p_board_id, p_after = lastSequence)`. The client does not pass a
   limit, so the database default of 500 operations per call applies. The engine repeats the call until it has
   reached the `last_sequence` the server reported or a batch comes back empty, up to 50 batches.
2. **Apply** the batch in sequence order, skipping anything at or below `lastSequence`, then drain any buffered
   broadcasts that now follow on.
3. **Resend** everything still in the pending queue, oldest first, with the same `operation_id`s.
4. **Deduplicate.** An operation that did reach the server before the connection dropped comes back as
   `duplicate` and is removed from the queue without being applied twice.

Operations left in `localStorage` by a previous session are sent the same way when the board is next opened.

### Backoff

`backoffDelay` in `src/lib/board/backoff.ts` is exponential backoff with full jitter:

```
delay = random in [0, min(30000 ms, 500 ms * 2^attempt)]
```

The engine adds 50 ms to that, and uses at least 5000 ms when the error was `RATE_LIMITED`. The attempt counter
goes up with each scheduled retry and resets to 0 after a successful submit or a successful recovery. No retry is
scheduled while the browser reports offline; the `online` event restarts things.

Re-joining dropped channels is left to `supabase-js`. Foreman only observes each channel's subscribe status.

### Known edge in gap handling

If a gap is detected while a recovery request is already in flight, the engine does not queue a second recovery;
it relies on the in-flight one. If that request was answered before the missing operations were committed, the
buffered operation waits until the next trigger above (in practice, the next broadcast or acknowledgement).
Nothing is lost, but the board can lag by one event until then.

## Save and connection status

The engine exposes one status. The first matching row wins.

| Status         | Shown as       | Condition                                                                                                                                                                                    |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failed`       | "Sync failed"  | A blocking error was returned (`UNAUTHENTICATED`, `BOARD_NOT_FOUND`, `BOARD_ACCESS_DENIED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_INACTIVE`). Cleared by `retry()` or by discarding unsent changes. |
| `offline`      | "Offline"      | `navigator.onLine` is false.                                                                                                                                                                 |
| `reconnecting` | "Reconnecting" | A retry timer is pending, or not all five channels are joined.                                                                                                                               |
| `saving`       | "Saving"       | The pending queue is not empty.                                                                                                                                                              |
| `saved`        | "Saved"        | None of the above.                                                                                                                                                                           |

The board UI adds two display rules on top: if access to the board has been lost it shows "Sync failed"
regardless, and for someone who cannot edit it shows "View only" in place of "Saved".

"Connected" for Realtime means all five channels report `SUBSCRIBED`. Any channel reporting anything else
(`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) makes the status `reconnecting` until all five are back, and the return
to connected triggers the catch-up described above.

## Comment and activity events

**Comments.** `add_comment`, `update_comment` and `delete_comment` each write the row, log activity, and then
broadcast `comment` with `action` `created`, `updated` or `deleted`. The client loads the first page (50) with
`get_board_comments` when the board opens and then merges events into that list: `created` is added at the top
unless a comment with that id is already there (the author's own client gets the comment back from the RPC as
well), `updated` replaces by id, `deleted` removes by id. A new comment from someone else is also announced to
screen readers.

**Activity.** Every `private.log_activity` call broadcasts `activity`, including when a burst of moves or updates
is folded into an existing row (the `id` is then the existing row's). The client uses the event in two ways:

- If `type` is a membership or board-settings change (`INVITATION_ACCEPTED`, `MEMBER_JOINED`, `MEMBER_LEFT`,
  `MEMBER_REMOVED`, `MEMBER_ROLE_CHANGED`, `OWNERSHIP_TRANSFERRED`, `JOIN_REQUEST_APPROVED`, `BOARD_RENAMED`,
  `SHARING_UPDATED`, `BOARD_DELETED`), it re-reads the board and member list from the database. This is how a role
  change, a rename or a removal reaches an open board. If that read is refused, the access-lost screen is shown.
- If the Activity tab has been opened, it reloads the first page (30) with `get_board_activity`, debounced by
  400 ms.

Activity for a board that is being moved to Trash is logged before `deleted_at` is set, in the same transaction,
so members receive `BOARD_DELETED` on a channel they are still authorised for.

Comments and activity have no sequence numbers and no catch-up query. After a reconnect the comment list is not
re-fetched automatically; events missed while disconnected appear when the list is next loaded.

## Limits and validation

| Limit or check                                      | Value                                                                                                                                              | Enforced by                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Topic format                                        | `board:<lower-case uuid>:(operations\|presence\|cursors\|comments\|activity)`                                                                      | Database (policy helper)            |
| Who may listen / send                               | See [Authorisation](#authorisation)                                                                                                                | Database (policies)                 |
| Operation type                                      | Five known types, otherwise `VALIDATION_FAILED`                                                                                                    | Database                            |
| Operation payload size                              | 65,536 bytes of JSON text                                                                                                                          | Database                            |
| Object text                                         | 5000 characters                                                                                                                                    | Database                            |
| Drawing points                                      | 4000 numbers (2000 points), each within ±100,000                                                                                                   | Database                            |
| Unknown or invalid object properties                | Dropped                                                                                                                                            | Database (`private.sanitize_props`) |
| Live objects per board                              | 5000                                                                                                                                               | Database                            |
| Comment body                                        | 2000 characters                                                                                                                                    | Database                            |
| Canvas operations                                   | 600 per user per minute                                                                                                                            | Database                            |
| Comments (add and edit together)                    | 60 per user per 10 minutes                                                                                                                         | Database                            |
| Incoming `operation` payload shape                  | UUID ids, positive integer sequence, known operation and object type, `object.id` equals `object_id`, numeric geometry and version, object `props` | Client (`parseServerOperation`)     |
| Incoming `comment` payload shape                    | UUID comment id, known action, string body unless deleted                                                                                          | Client (`parseCommentEvent`)        |
| Incoming `activity` payload shape                   | UUID id, string type                                                                                                                               | Client (`parseActivityEvent`)       |
| Incoming `cursor` payload shape                     | UUID `user_id`, finite `x`, `y` within ±1,000,000                                                                                                  | Client (`parseCursor`)              |
| Unknown event names                                 | Ignored: the client subscribes to exactly one event name per channel                                                                               | Client                              |
| Cursor send rate, cursor receive budget, cursor TTL | 80 ms, 30 per second per sender, 8 s                                                                                                               | Client                              |
| Persisted pending queue                             | 500 operations                                                                                                                                     | Client                              |

A payload that fails client validation is dropped silently; it never reaches board state.

Two things are **not** limited by Foreman:

- The size and event name of client broadcasts on `:cursors`, and the content of presence payloads. The database
  policy checks only membership, topic and extension. Whatever limits Supabase Realtime applies to message size
  and rate are its own and have not been measured here.
- The cursor throttle and the receive budget are in the client. They protect well-behaved clients from each
  other and from a noisy sender; they are not a server-side limit.

Rate limits for the other database functions are listed in
[Supabase schema: rate limits](supabase-schema.md#rate-limits).

## Not yet verified on real Supabase

Everything in this section needs a real project. Use two browsers (or one normal and one private window) with two
accounts, and a third account that is not on the board.

Setup and joining

- [ ] `realtime.messages` has RLS enabled and both `foreman:` policies exist after `supabase db push`.
- [ ] A member (try each of owner, editor, viewer) joins all five private channels: the status reaches "Saved"
      or "View only" and does not stay on "Reconnecting".
- [ ] A signed-in non-member is refused on every topic. (Opening the board URL only shows the "unavailable"
      page, which never connects. To test the socket itself, subscribe to `board:<id>:operations` with
      `private: true` from that account's browser console and expect a channel error.)
- [ ] An anonymous client is refused.
- [ ] A subscription to the same topic without `private: true` receives none of the database broadcasts.

Database-originated broadcasts

- [ ] After an edit in browser A, browser B receives an `operation` event and the object appears without a
      reload.
- [ ] The received payload has the fields listed under [Payloads](#payloads). Check whether Realtime adds fields
      of its own to the payload; the client parsers ignore extra fields, but this has not been observed.
- [ ] `comment` and `activity` events arrive on their channels.
- [ ] Messages are delivered only after the transaction commits, and nothing arrives for a rejected operation.
- [ ] `realtime.send` succeeds when called from a `SECURITY DEFINER` function owned by the migration role. If it
      does not, edits will still save (the failure is caught and logged as a `foreman: realtime broadcast failed`
      warning in the Postgres logs) but nobody will see them live.

Sending restrictions

- [ ] A member can send `cursor` on `:cursors` and track presence on `:presence`.
- [ ] A member's attempt to broadcast on `:operations`, `:comments` or `:activity` is rejected by Realtime and
      not delivered to others.

Presence and cursors

- [ ] Opening the board in B shows B in A's People list; closing B's tab removes it, and how long that takes.
- [ ] B's cursor moves in A, disappears about 8 seconds after B stops, and is not sent while B's tab is hidden.
- [ ] Two tabs for the same account (same presence key) behave sensibly: one closing does not remove the person
      while the other is open.

Reconnect

- [ ] With A offline (browser dev tools), edits queue ("Offline"), and on reconnect they are sent once and B
      sees them once.
- [ ] Edits made by B while A was offline appear in A after reconnect (catch-up query), in the right order.
- [ ] Killing only the WebSocket (not HTTP) shows "Reconnecting", `supabase-js` re-joins the channels, and the
      status returns to "Saved".
- [ ] Reloading with unsent operations in `localStorage` sends them on the next load.

Tokens and removal

- [ ] After the access token is refreshed, the channels stay joined and keep receiving (the refreshed token
      reaches the Realtime connection).
- [ ] Leave a board open past the access-token lifetime and confirm it keeps working.
- [ ] Remove member B while B has the board open. Expected: B's client shows the access-lost screen within
      moments; B's writes fail immediately. Then, with a client that does not leave voluntarily, measure how long
      B's socket keeps receiving `operation` events, and confirm it stops by the time the token would have been
      refreshed.
- [ ] Move a board to Trash while members have it open: they receive `BOARD_DELETED` and lose access.
- [ ] Sign out in one tab and confirm the Realtime connection in that browser stops receiving.

Load

- [ ] Drag an object continuously for a while with a second user watching: no `RATE_LIMITED` in normal use, and
      what the Realtime quotas of your plan do to cursor traffic with several people on a board.

The scripted walk-through is in [Demo script](demo-script.md); how to run the real end-to-end suite is in
[Testing](testing.md).
