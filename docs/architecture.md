# Architecture

This document describes how Foreman is put together as the code stands today: where things live, how a request
moves through the system, how the board stays in sync, and why the main design choices were made.

Read the status note in the [README](../README.md#read-this-first-what-has-and-has-not-been-verified) first.
Everything here describes code that exists and passes its local tests. The parts that talk to Supabase Auth and
Supabase Realtime have not been run against a live project, and that is called out where it matters.

Related documents: [Supabase schema and policies](supabase-schema.md), [Realtime](realtime.md),
[Security](security.md), [Testing](testing.md).

## The system in one picture

```
  +--------------------------------- Browser ----------------------------------+
  |  Server-rendered pages and client components                               |
  |  Board workspace:  CanvasStage -- BoardEngine -- BoardServices             |
  +-------+--------------------------------+-----------------------+-----------+
          |                                |                       |
          | page requests,                 | RPC over HTTPS        | WebSocket,
          | Server Actions                 | (anon key + user JWT) | private channels
          v                                |                       |
  +----------------------------------+     |                       |
  | Next.js on Render (one process)  |     |                       |
  |   src/proxy.ts: session refresh  |     |                       |
  |   Server Components, Actions,    |     |                       |
  |   Route Handlers                 |     |                       |
  +---------------+------------------+     |                       |
                  | RPC / select,          |                       |
                  | as the same user       |                       |
                  v                        v                       v
  +--------------------------------------------------------+   +----------------+
  | Supabase Postgres                                      |   | Supabase       |
  |   tables: SELECT only for API roles, limited by RLS    |   | Realtime       |
  |   functions: every write, SECURITY DEFINER, auth.uid() |-->| (broadcast,    |
  |   realtime.send(...) inside the write transaction      |   |  presence)     |
  +--------------------------------------------------------+   +----------------+
```

Two things in this picture are easy to miss:

- **The browser talks to Supabase directly for the board.** Canvas operations, comments, sharing settings and the
  realtime channels do not pass through the Next.js server. The Next.js server renders pages, runs Server
  Actions for account and dashboard work, and refreshes the session cookie.
- **Both paths use the same credentials.** The Next.js server and the browser each create a Supabase client with
  the public anon key and the signed-in user's session. There is no privileged server-side client, so the
  database sees the real user on every call and applies the same rules to both paths.

## Directory map

```
src/
  proxy.ts                 request interception (this Next.js version's name for middleware)
  app/                     routes
  components/              React components
  lib/                     everything that is not a component
supabase/migrations/       schema, functions, RLS, realtime policies, template seed
tests/                     see testing.md
```

### `src/app`: route groups

Route groups (the parenthesised folders) organise layouts and do not appear in URLs.

| Path                                                                  | URL(s)                                                                                                               | Notes                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `page.tsx`, `layout.tsx`, `error.tsx`, `not-found.tsx`, `globals.css` | `/`                                                                                                                  | Landing page, root layout (fonts, toast provider, cookie banner, skip link), global error/404 pages. |
| `(auth)/`                                                             | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`                                        | Shared two-column frame in `(auth)/layout.tsx`.                                                      |
| `(app)/`                                                              | `/dashboard`, `/templates`, `/boards/new`, `/boards/[boardId]/settings`, `/join`, `/invitations/accept`, `/settings` | Signed-in area. `(app)/layout.tsx` wraps pages in `AppShell`, which calls `requireProfile()`.        |
| `(board)/boards/[boardId]/page.tsx`                                   | `/boards/[boardId]`                                                                                                  | The whiteboard. Outside `(app)`, so it has no sidebar or header and fills the viewport.              |
| `(focus)/welcome/page.tsx`                                            | `/welcome`                                                                                                           | Post-verification welcome screen, no shell.                                                          |
| `(legal)/`                                                            | `/privacy`, `/terms`, `/cookies`                                                                                     | Static pages with their own layout.                                                                  |
| `auth/confirm/route.ts`                                               | `/auth/confirm`                                                                                                      | Route Handler that consumes links from Supabase Auth emails.                                         |
| `api/health/route.ts`                                                 | `/api/health`                                                                                                        | Liveness probe for Render.                                                                           |
| `api/account/export/route.ts`                                         | `/api/account/export`                                                                                                | Signed-in user's data as a JSON download.                                                            |
| `api/avatar/[style]/[seed]/route.ts`                                  | `/api/avatar/...`                                                                                                    | Generated SVG avatar. Public, immutable cache headers.                                               |

### `src/components`

| Folder / file                                                | Contents                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/`                                                        | Primitives: button, field, modal, menu, tabs, toast, tooltip, avatar, badge, skeleton, spinner, wordmark.                                                                                      |
| `auth/`                                                      | Login, register, forgot/reset password forms, the verify-email panel, the "Supabase not configured" notice.                                                                                    |
| `app/`                                                       | Signed-in shell and dashboard pieces: app shell, sidebar, board card, template gallery, create-board form, join form, invitation acceptance, notifications menu, profile menu, settings views. |
| `board/`                                                     | The whiteboard (described [below](#board-client-architecture)).                                                                                                                                |
| `marketing/`                                                 | Landing and legal page chrome.                                                                                                                                                                 |
| `cookie-consent.tsx`, `error-panel.tsx`, `template-card.tsx` | Shared one-off components.                                                                                                                                                                     |

### `src/lib`

| Module                 | Responsibility                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `env.ts`               | Reads the `NEXT_PUBLIC_*` values. `getPublicEnv()` returns `null` when Supabase is not configured.              |
| `errors.ts`            | The error vocabulary shared by server and browser. See [Error format](#error-format).                           |
| `log.ts`               | Server-only structured error logging (scope, code, request id; never messages or payloads).                     |
| `routes.ts`            | Which paths are protected or guest-only; `safeNextPath()` for redirect targets.                                 |
| `supabase/client.ts`   | Browser Supabase client (singleton).                                                                            |
| `supabase/server.ts`   | Per-request server Supabase client bound to the request cookies. Marked `server-only`.                          |
| `supabase/proxy.ts`    | `updateSession()`: session refresh and first-layer route protection, called from `src/proxy.ts`.                |
| `auth/dal.ts`          | Identity data-access layer: `getCurrentProfile()`, `requireProfile()`, `getActionUser()`. Marked `server-only`. |
| `auth/actions.ts`      | Server Actions for registration, login, logout, recovery, profile, account deletion, cookie consent.            |
| `auth/schemas.ts`      | Zod schemas used by both the forms and the Server Actions.                                                      |
| `auth/constants.ts`    | The recovery cookie name and lifetime.                                                                          |
| `boards/data.ts`       | Server-side reads for pages (`listBoards`, `loadBoardState`, `getBoardMembers`, templates). `server-only`.      |
| `boards/actions.ts`    | Server Actions for dashboard-level board work (create, rename, delete, restore, duplicate, join, invitations).  |
| `boards/schemas.ts`    | Zod schemas and collaboration-code normalisation.                                                               |
| `board/`               | The whiteboard's client-side model and sync engine. No React, no Supabase except `supabase-services.ts`.        |
| `templates/catalog.ts` | The six starter templates as data, and the generator for the seed migration.                                    |
| `templates/plans.ts`   | Plan descriptions and the entitlement rank check.                                                               |
| `avatar/generate.ts`   | Deterministic SVG avatar generation from a style and a seed.                                                    |
| `consent.ts`, `cn.ts`  | Cookie-consent record handling; class-name helper.                                                              |

### Module boundaries that are enforced

- `lib/supabase/server.ts`, `lib/auth/dal.ts`, `lib/boards/data.ts` and `lib/log.ts` import `server-only`, so
  the build fails if a client component imports them.
- `lib/board/*` (apart from `supabase-services.ts`) and `components/board/*` (apart from `board-client.tsx`) do
  not import Supabase. They depend on the `BoardServices` interface in `lib/board/services.ts`. This is what lets
  the browser tests run the real board against an in-memory backend.
- Server Actions and data functions never accept a user id or a role from their caller. The one place a user id
  is passed to the database (`leaveBoardAction`) takes it from the session profile.

## Request flow: a server-rendered page

Example: `GET /dashboard`.

1. **Proxy.** `src/proxy.ts` matches every path except static assets, `/api/avatar` and `/api/health`, and calls
   `updateSession()`.
   - It builds a Supabase server client over the request cookies and calls `auth.getClaims()`, which validates
     the JWT and refreshes an expired session. Refreshed cookies are written onto the response (and copied onto
     any redirect).
   - Not signed in and the path is protected (`/welcome`, `/dashboard`, `/templates`, `/boards`, `/join`,
     `/settings`, `/invitations`): redirect to `/login?next=<path>`.
   - Signed in and the path is guest-only (`/login`, `/register`, `/forgot-password`): redirect to `/dashboard`.
   - If the auth call throws, the request is treated as signed out. If Supabase is not configured at all,
     protected paths redirect to `/login` and public pages render.
   - Signed-in or protected responses get `Cache-Control: private, no-store`.
2. **Layout.** `(app)/layout.tsx` renders `AppShell`, which calls `requireProfile()`.
3. **Identity.** `requireProfile()` → `getCurrentProfile()` in `lib/auth/dal.ts`:
   - `await connection()` so the lookup is never prerendered;
   - `getClaims()` again for the user id;
   - `select` of the caller's own row from `profiles` (RLS returns only that row);
   - a profile whose `status` is not `ACTIVE` counts as signed out;
   - wrapped in React `cache()`, so the layout and the page share one lookup per request.

   No profile means `redirect("/login?next=…")`.

4. **Data.** The page calls `listBoards()` in `lib/boards/data.ts`, which calls the `list_boards` database
   function through the per-request client. The database decides what the caller may see.
5. **Render.** `next.config.ts` enables Cache Components, so the request-time parts of each page sit inside
   `<Suspense>` with a skeleton fallback and stream in when the data is ready.
6. **Errors.** Data functions throw an `AppError`. Pages catch it and show its safe message; anything uncaught
   reaches `(app)/error.tsx` or `app/error.tsx`.

The proxy check is deliberately not the only check. It is a fast first layer; the data-access layer repeats the
check inside every protected page, and the database enforces access regardless of both.

## Request flow: a Server Action

Example: creating a board from the form at `/boards/new`.

```
create-board-form.tsx (client)        lib/boards/actions.ts (server)           Postgres
------------------------------        -------------------------------          ----------------------
React Hook Form + Zod validate  -->   createBoardAction(input: unknown)
                                        createBoardSchema.safeParse(input)
                                        getPublicEnv()       else NOT_CONFIGURED
                                        getCurrentProfile()  else UNAUTHENTICATED
                                        supabase.rpc("create_board", ...)  -->  create_board(...)
                                                                                 caller = auth.uid()
                                                                                 checks, then writes
                                        toAppError(error) or data          <--  jsonb, or raise 'CODE'
                                        revalidatePath("/dashboard")
ActionResult: { ok, data } or   <--   return actionSuccess / actionFailure
  { ok: false, code, message,
    fields? }
```

Rules that hold for every action in `lib/auth/actions.ts` and `lib/boards/actions.ts`:

- The argument is typed `unknown` and re-validated on the server with the same Zod schema the form uses.
- The acting user comes from the session. Board actions pass only board, invitation or request ids.
- The action returns an `ActionResult` and does not throw for expected failures. `logoutAction` and
  `logoutEverywhereAction` are the exceptions: they redirect.
- Responses that could reveal whether an account exists are generic. `registerAction` returns success for an
  already-registered email; `forgotPasswordAction` and `resendVerificationAction` always return success unless
  rate-limited; `loginAction` returns one `INVALID_CREDENTIALS` for every credential failure.
- Unknown failures are logged with `logServerError` (scope, normalised code, upstream error code, request id).

Not every mutation is a Server Action. Inside an open board, renaming, comments, sharing settings, invitations
and member management go from the browser straight to database functions through `BoardServices`.

## Authentication and sessions

### Three Supabase clients, one set of credentials

| Client                         | Created in               | Cookie access                                                                 |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------------------- |
| Browser (`getBrowserClient`)   | `lib/supabase/client.ts` | `createBrowserClient` from `@supabase/ssr`; one instance per page load.       |
| Server (`createClient`)        | `lib/supabase/server.ts` | Next.js `cookies()`. Writes are ignored in Server Components (read-only).     |
| Proxy (inside `updateSession`) | `lib/supabase/proxy.ts`  | Request cookies in, response cookies out. This is where refreshes are stored. |

All three use `NEXT_PUBLIC_SUPABASE_URL` and the anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, or
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as an alternative name). The session lives in cookies managed by
`@supabase/ssr`.

### Flows

- **Register.** `registerAction` checks `username_available`, then calls `auth.signUp` with profile fields in
  the user metadata and `emailRedirectTo: <site>/auth/confirm?next=/welcome`. A database trigger creates the
  profile row and re-validates every metadata field.
- **Email links.** `/auth/confirm` accepts `?token_hash=…&type=recovery|email|signup` (verified with
  `verifyOtp`) or `?code=…` (exchanged with `exchangeCodeForSession`). It consumes the token on the server and
  redirects to a clean URL: `/verify-email?status=verified&next=…` on success, `/verify-email?status=invalid` or
  `/reset-password?status=invalid` on failure. `/verify-email?token_hash=…` is also handled directly by the
  page, through `verifyEmailAction`.
- **Login.** `loginAction` calls `signInWithPassword`, then reads the profile status and signs the session out
  again if the account is not `ACTIVE`. The redirect target passes through `safeNextPath()`.
- **Password recovery.** After verifying a recovery link, `/auth/confirm` sets an httpOnly cookie
  (`fm_recovery`, 15 minutes) holding the user id and redirects to `/reset-password`. `resetPasswordAction`
  refuses to set a password unless that cookie matches the session's user id, then signs out every session.
- **Password change.** `changePasswordAction` re-checks the current password with `signInWithPassword`, updates
  it and signs out other sessions.
- **Logout.** `logoutEverywhereAction` calls `auth.signOut({ scope: "global" })`. `logoutAction` calls
  `auth.signOut()` with no scope, and in the installed `@supabase/auth-js` the default scope is also `global`.
  As written, both therefore end every session for the account, not only the current one.
- **Account deletion.** Password re-check, typed confirmation, `request_account_deletion` in the database, then
  a global sign-out. Removing the auth record itself is a manual operator step (see [Security](security.md)).

### Running without Supabase

When `getPublicEnv()` returns `null`, public pages render, the login, register, forgot-password and verify-email
pages show a setup notice, protected routes redirect to `/login`, and actions return `NOT_CONFIGURED`. No live
project has been available so far, so this is the only mode the built application has been in.

## Board client architecture

```
app/(board)/boards/[boardId]/page.tsx      server: requireProfile, load_board_state, get_board_members
  board-client.tsx                         creates the Supabase BoardServices (only Supabase-aware component)
    board-workspace.tsx                    owns BoardEngine, realtime wiring, view state, shortcuts
      canvas-stage.tsx                     SVG canvas, pointer gestures, text editor, remote cursors
        object-shape.tsx                   one SVG group per object
      board-top-bar.tsx, tool-rail.tsx, zoom-controls.tsx, object-toolbar.tsx
      side-panel.tsx                       People, Comments, Activity, Outline
      share-dialog.tsx, sharing/           sharing settings, invitations, join requests, members
      export-dialog.tsx, command-palette.tsx, shortcuts-dialog.tsx
```

### `src/lib/board`

| File                                          | Role                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`                                    | Shapes shared with the database JSON: `CanvasObject`, `ServerOperation`, `PendingOperation`, `SubmitResult`, `BoardState`. Six object types, five operation types. |
| `reducer.ts`                                  | Pure state transitions: `buildDocument`, `applyServerOperation(s)`, `applyLocalOperation`, `projectView`, `visibleObjects`, `upsertObject`.                        |
| `engine.ts`                                   | `BoardEngine`: the pending queue, optimistic view, acknowledgement, gap recovery, retry, undo/redo, status.                                                        |
| `services.ts`                                 | The `BoardServices` interface (transport, realtime, comments, activity, sharing) and its data types.                                                               |
| `supabase-services.ts`                        | The Supabase implementation of `BoardServices`, and the validators for incoming realtime payloads.                                                                 |
| `storage.ts`                                  | `PendingStore`: the durable queue in `localStorage`, plus an in-memory variant for tests.                                                                          |
| `backoff.ts`                                  | Exponential backoff with full jitter (base 500 ms, cap 30 s).                                                                                                      |
| `export.ts`                                   | PNG export: redraws objects onto an off-screen 2D canvas.                                                                                                          |
| `geometry.ts`                                 | Camera maths, bounds, resize, stroke simplification, arrowheads.                                                                                                   |
| `defaults.ts`, `tools.ts`, `activity-text.ts` | Default payload per object type, colour palettes, tool definitions and shortcuts, activity wording, cursor colours.                                                |

### The engine's state

`BoardEngine` keeps two things apart:

- the **confirmed document**: objects as the server last reported them, plus `lastSequence`, the highest board
  sequence number applied without a gap;
- the **pending queue**: operations created locally that the server has not acknowledged.

What the UI renders is `projectView(document, pending)`: the confirmed document with the pending operations
replayed on top. When a remote change arrives the document changes and the same pending operations are replayed
over the new base. React reads the result with `useSyncExternalStore(engine.subscribe, engine.getSnapshot)`.

The engine contains no network code. It is given a `BoardTransport` with two methods, `submit(operation)` and
`fetchAfter(sequence)`, and is told about the outside world through `receive()`, `setOnline()` and
`setRealtimeConnected()`.

Engine status, shown in the top bar: `saved`, `saving` (queue not empty), `offline` (browser reports offline),
`reconnecting` (retry timer running or realtime not joined), `failed` (a blocking error; see below).

### Rendering

`canvas-stage.tsx` renders one `<svg>` whose content is transformed by the camera (pan and zoom).
`object-shape.tsx` draws each object with SVG primitives; text is a `<foreignObject>` containing an HTML block,
so user text is rendered as text by React and wraps with normal CSS. Selection outlines, resize handles, the
in-place text editor (`<textarea>`) and remote cursors are HTML elements positioned over the SVG. The same
`ObjectShape` component draws board and template previews and the marketing illustrations, through
`board-preview.tsx`.

## How a canvas operation travels

Example: the owner drags a sticky note while an editor has the board open.

```
Owner's browser                            Postgres                             Editor's browser
-----------------------------------        -------------------------------      ------------------------
pointerdown / pointermove:
  local preview only
pointerup -> engine.move(id, {x, y})
  dispatch(): new PendingOperation
    operation_id (new UUID),
    expected_version, client_timestamp
  record undo entry
  append to queue, save to localStorage
  emit -> UI shows the new position
  flush(): transport.submit(queue[0]) -->  submit_operation(...)
                                             verified user, OWNER or EDITOR
                                             validate, rate limit
                                             lock board row
                                             operation_id seen? -> duplicate
                                             lock object, conflict checks
                                             update object, version + 1
                                             boards.last_sequence = n
                                             insert board_operations (seq n)
                                             activity; snapshot if due
                                             realtime.send on
                                               board:<id>:operations     -->    broadcast "operation"
  ack {accepted, sequence n, object}  <--  return                               parseServerOperation()
  remove from queue, save                                                       engine.receive()
  store object, lastSequence = n                                                  seq = last + 1: apply
  status -> saved                                                                 seq > last + 1: buffer,
                                                                                    then fetchAfter(last)
```

Step by step:

1. **Gesture.** While dragging, `CanvasStage` keeps a local preview and submits nothing. On pointer-up it calls
   `onMove` once, so a drag is one operation. Resizing and arrow-end drags call `onUpdate` once; drawing a
   shape, placing a note or finishing a pen stroke calls `onCreate` once; committing the text editor calls
   `onUpdate` with the new text.
2. **Dispatch.** `BoardEngine.dispatch` refuses the edit if the user cannot edit, or if the target object is
   missing or deleted (or, for a create, already exists). Otherwise it creates a `PendingOperation` with a
   fresh `operation_id` and `expected_version` set to the object's version in the current optimistic view,
   records the inverse for undo, appends the operation to the queue, saves the queue and notifies React.
3. **Submit.** `flush()` sends the head of the queue and waits for the verdict before sending the next one, so
   operations from one client always arrive in order. The Supabase transport calls the `submit_operation`
   database function.
4. **Database.** `submit_operation` (see `supabase/migrations/20261008000400_canvas_comments_activity.sql`) is
   the single write path for the canvas. It takes the actor from `auth.uid()`, requires a verified user with the
   `OWNER` or `EDITOR` role, validates and sanitises the payload, enforces a rate limit of 600 operations per
   minute, and locks the board row. Holding that lock makes the per-board sequence number gap-free. A repeated
   `operation_id` returns `duplicate` with the original sequence and changes nothing. An accepted operation
   updates the object, increments its version, writes the operation row with the resulting object state, logs
   activity, takes a snapshot when the sequence is a multiple of the snapshot interval (50 by default), and
   calls `realtime.send` on the private topic `board:<id>:operations`. All of that is one transaction.
5. **Acknowledge.** The acknowledgement is the only thing that removes an operation from the queue. The engine
   stores the returned object and advances `lastSequence` if the returned sequence is the next one. If it is
   further ahead, somebody else's operations were sequenced in between and have not arrived yet, so the engine
   fetches them with `fetchAfter`.
6. **Fan-out.** Every client subscribed to the operations channel, including the sender, receives the broadcast.
   `parseServerOperation` validates the payload shape before it reaches the engine. `applyServerOperation` then
   applies it if it is the next sequence, ignores it if it is old (the sender's own acknowledgement usually got
   there first), or reports a gap. `upsertObject` never replaces a newer object version with an older one, so an
   acknowledgement racing a broadcast is harmless.
7. **Gaps.** An operation that arrives ahead of sequence is buffered and triggers `recover()`, which calls
   `get_operations_after(lastSequence)` repeatedly (the function returns at most 500 per call by default) until
   the client has caught up, then drains the buffer.

Failures in step 3 fall into three groups:

| Error codes                                                                                           | Engine behaviour                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK`, `UNKNOWN`, `RATE_LIMITED`, `NOT_CONFIGURED`                                                | Keep the operation, schedule a retry with backoff (at least 5 s after `RATE_LIMITED`). Status `reconnecting`.                                                           |
| `UNAUTHENTICATED`, `BOARD_NOT_FOUND`, `BOARD_ACCESS_DENIED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_INACTIVE` | Stop sending. Status `failed` with a persistent banner offering "Log in again" or "Try again", and an explicit, confirmed "Discard unsaved changes". The queue is kept. |
| Anything else (for example `VALIDATION_FAILED`, `OBJECT_NOT_FOUND`, `BOARD_OBJECT_LIMIT`)             | The server refused this particular operation. It is removed, its undo history is dropped, the user is told, and later operations are still sent.                        |

Comments, activity, presence and cursors use the other four channels and do not go through the engine. See
[Realtime](realtime.md).

## Load sequence

1. **Server.** The board page calls `requireProfile()`, then `loadBoardState(boardId)` and
   `getBoardMembers(boardId)`. `load_board_state` returns the board summary with the caller's role, the latest
   snapshot (`sequence` and `objects`), every operation accepted after that snapshot in sequence order, and the
   board's `last_sequence`. A board that does not exist and a board the caller cannot see produce the same
   "unavailable" page. A new board has a snapshot at sequence 0 containing its template objects, if any.
2. **Props.** The state, the member list and a minimal current-user object are passed to `BoardClient`.
3. **Document.** The `BoardEngine` constructor calls `buildDocument`: start from the snapshot's objects, apply
   the later operations in sequence order.
4. **Leftover work.** If the user can edit, the constructor loads the pending queue for this user and board from
   `localStorage` (key `foreman:pending:v1:<userId>:<boardId>`). Stored entries are treated as untrusted input
   and discarded if malformed. `engine.start()` begins re-sending them; the server's deduplication makes this
   safe for operations that did arrive before the page closed.
5. **Realtime.** `services.realtime.connect()` calls `supabase.realtime.setAuth()` and subscribes to five
   private channels. It reports `connected = true` only when all five are joined.
6. **Catch-up.** Operations accepted between the server render and the channel join are not in the props and
   were not broadcast to this client. The Supabase implementation reports `false` while channels are joining and
   `true` once all are joined; that transition makes the engine call `resync()`, which fetches everything after
   `lastSequence` and then flushes the queue. The same procedure runs whenever the browser comes back online or
   a dropped channel rejoins.
7. **Everything else.** Comments load on mount. Activity loads when its tab is first opened. The member list is
   refreshed when a membership or settings activity event arrives, or when presence shows an unknown user id.

Confirmed board state is never cached in the browser. Only unsent operations are stored.

Step 6 depends on Realtime channel behaviour that has only been exercised through the test harness, which
reports `true` immediately. Treat it as unverified until the [demo script](demo-script.md) has been run against
a live project.

## Conflict handling

There is no CRDT or operational transform. The server orders operations and applies a small set of rules; the
client reconciles to whatever the server says.

Each object has a `version` that increases by one on every accepted change.

| Situation                                                         | Server result                          | Rule                                            |
| ----------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| Move, resize, restyle or reorder while someone else did the same  | `accepted`                             | Last accepted operation wins. No version check. |
| Any move, update or delete of a deleted object                    | `conflict` / `OBJECT_DELETED`          | Deletion wins.                                  |
| Update that includes `props.text` with a stale `expected_version` | `conflict` / `TEXT_CONFLICT`           | Text is never silently overwritten.             |
| Create with an object id that already exists                      | `conflict` / `OBJECT_EXISTS`           |                                                 |
| Restore of an object that is not deleted                          | `conflict` / `OBJECT_NOT_DELETED`      |                                                 |
| Same `operation_id` submitted again                               | `duplicate` with the original sequence | Retries are applied once.                       |

Conflicts are returned, not raised. They come with the current server state of the object, consume no sequence
number, write no operation row and broadcast nothing.

On the client, a `conflict` acknowledgement removes the operation from the queue, replaces the object with the
server's version, marks undo entries for that object as blocked, and shows a message (for a text conflict:
"Someone else edited that text first. Their version is shown; make your change again if it still applies.").

Consequences worth knowing:

- The text check compares against the object's whole version, not a text-specific one. A text edit therefore
  also conflicts when someone else only moved or restyled the same object in the meantime.
- Two of your own queued edits to one object do not conflict with each other: each is stamped with the version
  from the optimistic view, which already counts the earlier ones.
- A pending local move stays visible on top of a remote change to the same object until the server answers,
  because the view is always "confirmed document plus pending operations".

## Undo and redo

Undo is implemented in `BoardEngine` as compensating operations. The operation log is never rewritten.

- When a local edit is dispatched, the engine records a history entry with the inverse operation, computed from
  the object as it was before the edit: create ↔ delete (redo of a create is a restore of the same object),
  delete ↔ restore, move ↔ move back to the previous position, update ↔ update with the previous values of
  exactly the fields that changed.
- `undo()` pops the entry and dispatches its inverse as a new operation with a new `operation_id`. It goes
  through the same queue, the same database function and the same conflict rules as any other edit, and other
  clients see it as an ordinary operation. The entry moves to the redo stack. `redo()` does the reverse.
- A new edit clears the redo stack.
- Only the current user's own edits are in the stacks, so undo never reverses someone else's work directly. When
  an operation from another user touches an object (through a broadcast or a recovery fetch), or one of your
  own operations on it comes back as a conflict, every history entry for that object is marked blocked.
  Undoing a blocked entry does nothing except discard it and show "That change can't be undone because someone
  else has edited the item since."
- If the server rejects an operation outright, the history entries for that object are dropped.
- The stacks hold at most 100 entries, live in memory only, and are lost on reload. They are also cleared when
  unsent work is explicitly discarded.

## Error format

`src/lib/errors.ts` defines one vocabulary for Server Actions, Route Handlers and the browser.

- **`ERROR_CATALOG`** maps each code (for example `BOARD_NOT_FOUND`, `RATE_LIMITED`, `INVITATION_EXPIRED`) to an
  HTTP status and a message that is safe to show.
- **Database functions** raise the code as the exception message with SQLSTATE `P0001`, for example
  `raise exception 'BOARD_NOT_FOUND' using errcode = 'P0001'`.
- **`toAppError(error)`** turns anything into an `AppError`: codes raised by the database, selected Postgres and
  PostgREST codes (`42501` and `PGRST301` → `UNAUTHENTICATED`; `23514`, `22P02`, `23502` → `VALIDATION_FAILED`),
  Supabase Auth codes (`invalid_credentials`, `email_not_confirmed`, `weak_password`, rate limits, expired
  links), and network failures. Anything unrecognised becomes `UNKNOWN` with a generic message, so SQL text and
  stack traces never reach a person.
- **Server Actions** return `ActionResult<T>`:

  ```ts
  { ok: true; data: T } | { ok: false; code: ErrorCode; message: string; fields?: Record<string, string> }
  ```

  `fields` maps form field names to messages for validation failures.

- **Route Handlers** return `ApiErrorBody` on failure, built by `apiErrorBody()`:

  ```json
  {
    "timestamp": "2026-10-08T12:00:00.000Z",
    "status": 401,
    "code": "UNAUTHENTICATED",
    "message": "Your session has expired. Log in again to continue.",
    "path": "/api/account/export",
    "requestId": "…"
  }
  ```

  `/api/account/export` is the only handler that currently returns this body.

- **The board** uses the same codes: `supabase-services.ts` converts every RPC error with `toAppError` before
  the engine or a panel sees it.

`BOARD_NOT_FOUND` deliberately has the message "Board not found or access is unavailable." so that a missing
board and a forbidden one read the same.

## Design decisions and trade-offs

### Writes go through database functions

Tables grant the API roles `SELECT` only, limited by Row Level Security. There are no insert, update or delete
policies. Every write is a `SECURITY DEFINER` function with a pinned `search_path` that reads the caller from
`auth.uid()` and checks their role.

- **Why.** The browser calls Supabase directly, so the database has to be the place where rules are enforced.
  One function can check the role, validate the payload, assign the sequence number, write the operation and
  emit the realtime message in a single transaction, which is what makes "a broadcast always describes a
  persisted operation" true. The same function serves the Next.js server and the browser.
- **Cost.** A large share of the application logic is PL/pgSQL (the migrations are about 3,000 lines of SQL).
  It is harder to step through than TypeScript, and the client keeps a parallel implementation of some rules
  for optimistic rendering (`reducer.ts`) that has to be kept in step by hand. Changing behaviour means a
  migration.

### No service-role key

The application never uses `SUPABASE_SERVICE_ROLE_KEY`, on the server or anywhere else.

- **Why.** A leaked or misused service-role key bypasses RLS entirely. Without it, a bug in a Server Action
  cannot read or write more than the signed-in user could from their own browser, and there is no secret to
  configure on Render at all.
- **Cost.** The app cannot do anything that needs administrative rights. Removing a deleted account's auth
  record is a manual operator step, and anything else that would need elevated access has to be written as a
  database function with its own checks.

### A purpose-built SVG renderer

The canvas is React-rendered SVG, not a canvas library.

- **What it buys.** No rendering dependency. Objects are DOM elements, so the browser tests can find and drag
  them, user text is rendered as text by React, and the same component draws live boards, board and template
  previews and the illustrations on the landing and sign-in pages.
- **Cost.** Every interaction is hand-written, which is why selection is single-object, there is no rotation
  handle and freehand drawings cannot be resized. One DOM subtree per object will not scale the way a bitmap
  canvas does; the database caps a board at 5,000 live objects, and rendering performance near that size has not
  been measured. PNG export needs a second renderer (`lib/board/export.ts`, 2D canvas) whose text wrapping can
  differ slightly from the screen.

### The board depends on an interface, not on Supabase

`BoardWorkspace` takes a `BoardServices` object. `board-client.tsx` supplies the Supabase one.

- **Why.** The whole board UI and sync engine can run in a real browser against an in-memory backend, with
  several users, offline periods and dropped events, without a Supabase project.
- **Cost.** The in-memory backend re-implements the server's rules and can drift from the database functions.
  The Supabase implementation itself (`supabase-services.ts`) is the one piece of the board that browser tests
  do not execute, apart from its payload validators.

### Server-sequenced operation log with snapshots

Each board has an append-only `board_operations` log with a gap-free sequence, plus periodic snapshots.

- **Why.** A total order makes missed-message detection trivial (a gap in the numbers), makes loading cheap
  (snapshot plus tail), and makes retries idempotent through `operation_id`.
- **Cost.** Every write to a board takes a row lock on that board, so writes to one board are serialised.
  Concurrent text edits are rejected rather than merged.

### Realtime messages are sent by the database, and may be missed

Operations, comments and activity are broadcast with `realtime.send` from inside the write function. Clients
have no permission to send on those topics. `private.broadcast` catches and downgrades any error from
`realtime.send` to a warning.

- **Why.** Clients cannot forge another user's edit, and a Realtime outage cannot undo or block a user's write.
- **Cost.** Delivery is not guaranteed, so the client must detect gaps and recover. That logic is the most
  intricate part of the engine.

### A durable queue in `localStorage`

- **Why.** Closing the tab or losing the connection does not lose unsent edits.
- **Cost.** The queue is per browser, holds at most 500 operations, contains the content of the unsent edits,
  and is not cleared on logout. It is keyed by user id and board id, so another account on the same browser
  does not load it.

### Three layers of route protection

The proxy redirects early, the data-access layer checks again in every protected page and action, and the
database checks on every call. The first two exist for user experience and defence in depth; only the third is
relied on for security.

### One web service

There is one Node process on Render and one managed Supabase project: no containers, no reverse proxy, no
queue, no separate WebSocket server. Realtime fan-out is Supabase's job. The cost is a hard dependency on
Supabase's Auth, PostgREST and Realtime behaviour, which is exactly the part that has not yet been verified
end to end.
