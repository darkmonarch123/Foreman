# Security

This document describes the security-relevant behaviour of Foreman as the code stands today, the reasoning behind
it, and the places where it is weak or untested. It is written from the code, not from intent: where something is
not implemented, it says so.

## Read this first: what has been checked

Foreman has **never been run against a live Supabase project and has never been deployed**. Everything below
falls into one of three groups, and each section says which one applies.

| Evidence                | What it means here                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tested in the database  | `tests/db` applies the real migrations to an in-process Postgres (PGlite) with a small stand-in for Supabase's `auth` and `realtime` schemas (`tests/db/supabase-shim.sql`) and calls the functions as API roles. |
| Tested with mocks       | `tests/unit` and `tests/components` run server actions, the proxy and forms with Supabase mocked at the client boundary.                                                                                          |
| Read from the code only | No automated test. This includes all response headers, CSRF behaviour, cookie attributes in a real browser, Supabase Auth itself, and the Realtime transport.                                                     |

No penetration test, external review or load test has been done. See
[Known weaknesses and untested areas](#known-weaknesses-and-untested-areas) for the consolidated list and
[Testing](testing.md) for what each suite proves.

## Threat model in brief

Foreman is a multi-user whiteboard. The things worth protecting are board content (objects, comments, activity),
who is on a board and with which role, account credentials and sessions, and email addresses.

The attackers considered:

- **An anonymous visitor** trying to read boards, enumerate accounts, or guess codes and tokens.
- **A signed-in user who is not a member** of a board trying to read or change it, or to confirm that it exists.
- **A member with a lower role** (a viewer, or an editor) trying to do what only a higher role may do.
- **A member acting maliciously within their role**, for example putting hostile text or style values on a board
  to attack other members' browsers, or flooding a board.
- **Someone holding a leaked link or code** (invitation link, share link, collaboration code).
- **A hostile web page** in the victim's browser attempting cross-site requests or framing.

Not addressed: a compromised Supabase project or operator, a compromised hosting platform, malware on the user's
device, and denial of service beyond the per-user limits listed under [Rate limiting](#rate-limiting).

### Trust boundaries

```
Browser  ──(1)──►  Next.js server (Server Components, Server Actions, Route Handlers)
   │                        │
   │                        └──(2)──►  Supabase, as the signed-in user (anon key + session JWT)
   │
   ├──(3)──►  Supabase REST/RPC directly, as the signed-in user
   └──(4)──►  Supabase Realtime (private channels)
```

- **The browser is untrusted.** It holds the public anon key and the user's own session. It talks to Supabase
  directly (3, 4): the board UI calls database functions from the browser (`src/lib/board/supabase-services.ts`),
  so for canvas operations, comments and sharing the Next.js server is not in the path at all.
- **The Next.js server is a convenience layer, not the authority.** It validates input and shapes error messages
  (1), then calls Supabase with the user's own cookies (2). It holds no credential that the browser does not also
  hold. It never uses the service-role key.
- **The database is the authority.** Every decision about who may read or change what is made in Postgres, from
  `auth.uid()`, by Row Level Security policies and `SECURITY DEFINER` functions. A request that bypasses the
  Next.js server entirely meets the same checks.

The practical consequence: client-side checks (hidden buttons, disabled tools, Zod validation in forms) are
usability features. Do not read them as controls.

## Authentication and sessions

Authentication is Supabase Auth with email and password. Foreman's code never stores, hashes or logs a password;
passwords are passed straight to Supabase Auth from server actions (`src/lib/auth/actions.ts`).

### Session cookies

Sessions are handled by `@supabase/ssr` (version 0.12.7 is the one installed and inspected for this document).
The session, that is the access token (a JWT) and the refresh token, is stored in cookies whose names begin
`sb-`.

Foreman passes the library's cookie options through unchanged (`src/lib/supabase/server.ts`,
`src/lib/supabase/proxy.ts`). In the installed version those defaults are:

| Attribute  | Value                                                    |
| ---------- | -------------------------------------------------------- |
| `Path`     | `/`                                                      |
| `SameSite` | `Lax`                                                    |
| `HttpOnly` | **not set** (the browser Supabase client has to read it) |
| `Secure`   | **not set by the library or by Foreman**                 |
| `Max-Age`  | 400 days                                                 |

Three honest consequences:

- **The session cookie is readable by JavaScript.** That is required for the browser client to call Supabase and
  open Realtime channels as the user. It also means a successful script injection could read the tokens. The
  defences against injection are described under [Output encoding and XSS](#output-encoding-and-xss) and
  [Security headers](#security-headers); the CSP does not fully close this (see the `'unsafe-inline'` trade-off).
- **`Secure` is not set explicitly.** In production the app sends `Strict-Transport-Security` and
  `upgrade-insecure-requests`, so a browser that has visited the site uses HTTPS only, but the cookie attribute
  itself is not there.
- **The cookie is long-lived.** "Nothing long-lived in `localStorage`" is true; the refresh token lives in a
  cookie instead, for up to 400 days unless the session is revoked or Supabase's own session limits end it sooner.

The proxy (`src/proxy.ts`, calling `updateSession` in `src/lib/supabase/proxy.ts`) runs on every request except
static assets, `/api/avatar` and `/api/health`. It refreshes the session cookie, and it decides whether the
request is authenticated with `supabase.auth.getClaims()` rather than by trusting the cookie's contents. If the
Auth service cannot be reached it fails closed: protected routes redirect to `/login`. Responses to
authenticated requests and to protected paths get `Cache-Control: private, no-store`.

### What is stored in the browser

| Where            | Key                                       | Content                                                                                                               | Lifetime                                                 |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Cookie           | `sb-…` (set by `@supabase/ssr`)           | Access token and refresh token                                                                                        | Up to 400 days; replaced on refresh, cleared on sign-out |
| Cookie           | `fm_recovery`                             | The user id a password-recovery link was verified for. `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`   | 15 minutes; deleted when the password is set             |
| `localStorage`   | `foreman:cookie-consent`                  | `{ version, analytics, preferences, decidedAt }`                                                                      | Until cleared or the consent version changes             |
| `localStorage`   | `foreman:pending:v1:<user id>:<board id>` | Board operations the server has not acknowledged yet, at most 500. **Includes the text and geometry of those edits.** | Removed when the queue empties                           |
| `sessionStorage` | `foreman:verify-email`                    | The email address just used to register, to prefill "resend verification"                                             | The tab's lifetime                                       |
| IndexedDB        | none                                      | Not used                                                                                                              |                                                          |

The pending-operation queue is validated when it is read back (`src/lib/board/storage.ts` discards anything that
is not a well-formed operation), and the board itself is never cached in the browser. One gap: **logging out does
not clear the pending queue.** If someone logs out with unsent edits on a shared computer, those edits stay in
`localStorage` until that same user opens that board again in that browser.

### Route protection

There are three layers, and only the last one is authoritative:

1. **Proxy** (`src/lib/routes.ts`): requests under `/welcome`, `/dashboard`, `/templates`, `/boards`, `/join`,
   `/settings` and `/invitations` without a valid session are redirected to `/login?next=…`. Signed-in users are
   sent away from `/login`, `/register` and `/forgot-password`. With Supabase unconfigured, protected routes
   redirect to `/login`.
2. **Data-access layer** (`src/lib/auth/dal.ts`): every protected page, server action and the export route
   handler calls `getCurrentProfile()` / `requireProfile()`, which re-checks the claims, loads the caller's own
   profile row and returns nothing unless its status is `ACTIVE`.
3. **Database**: RLS and the functions described under [Authorization model](#authorization-model).

Layers 1 and 2 are covered by `tests/unit/proxy.test.ts`, `tests/unit/routes.test.ts` and
`tests/unit/server-actions.test.ts` with Supabase mocked.

### Signing out

| Action                                          | Scope passed to Supabase Auth |
| ----------------------------------------------- | ----------------------------- |
| "Log out" in the account menu                   | This session                  |
| "Sign out of all sessions" (Settings, Sessions) | `global`                      |
| Password changed from Settings                  | `others` (this device stays)  |
| Password set from a reset link                  | `global`                      |
| Account deletion requested                      | `global`                      |

Individual sessions cannot be listed or revoked one by one.

Revoking a session stops it being refreshed. An access token that has already been issued is a signed JWT, and
nothing in Foreman rejects it before it expires, so keep the access-token lifetime short in the Supabase project
(the README suggests an hour or less). The same lifetime bounds how long a removed member can keep listening on
Realtime; see [Realtime](realtime.md).

### Email verification

There are two gates.

**Gate 1: Supabase Auth, by configuration.** With "Confirm email" turned on in the Supabase project (a manual
setup step in the README), Supabase refuses password sign-in for an unconfirmed address. `loginAction` shows
"Verify your email address to use this feature." in that case. This is a dashboard setting, not code: if it is
left off, only gate 2 applies.

**Gate 2: the database, in code.** `profiles.email_verified` is copied from `auth.users.email_confirmed_at` by a
trigger. The helper `private.require_verified_user()` raises `ACCOUNT_INACTIVE` unless the profile is `ACTIVE` and
`EMAIL_NOT_VERIFIED` unless the email is verified. These functions call it:

| Area                  | Functions that require a verified email                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Boards                | `create_board`, `update_board`, `delete_board`, `restore_board`, `purge_board`, `duplicate_board`                               |
| Sharing               | `update_sharing`, `regenerate_collaboration_code`, `regenerate_share_link`, `join_board`                                        |
| Members               | `change_member_role`, `remove_member`, `transfer_ownership` (the new owner must also be verified and active)                    |
| Invitations, requests | `create_invitation`, `resend_invitation`, `revoke_invitation`, `accept_invitation`, `decline_invitation`, `decide_join_request` |
| Canvas                | `submit_operation`                                                                                                              |
| Comments, export log  | `add_comment`, `update_comment`, `delete_comment`, `record_board_export`                                                        |

Functions that need a session but **not** a verified email: all reads (`get_board`, `list_boards`,
`load_board_state`, `get_operations_after`, `get_board_members`, `get_board_comments`, `get_board_activity`,
`get_sharing`, `list_board_invitations`, `list_join_requests`, `get_notifications`, `list_my_invitations`), and
the account's own housekeeping (`update_profile`, `regenerate_avatar`, `update_notification_prefs`,
`record_cookie_consent`, `export_my_data`, `request_account_deletion`). `list_my_invitations` returns an empty
list for an unverified caller, and the RLS policy on `board_invitations` matches invitees by verified email only.

In practice an unverified user cannot be a member of any board (joining and accepting both require verification),
so the reads return nothing for them. The gate is tested in `tests/db` ("requires a verified email address",
"does not let an unverified member act", "are unavailable for deleted boards and unverified users").

Verification links land on the server: `/auth/confirm` (`src/app/auth/confirm/route.ts`) accepts
`?token_hash=…&type=…` or `?code=…`, consumes the token and redirects to a clean URL. With the recommended email
template the link goes to `/verify-email?token_hash=…`, which verifies through a server action and then replaces
the URL. The three pages that can carry a token in the URL (`/verify-email`, `/join`, `/invitations/accept`) set
`referrer: no-referrer`.

### Passwords

- **Policy** (`src/lib/auth/schemas.ts`, enforced in the form and again in the server action): 10 to 72
  characters, at least one letter and one digit. Supabase's own minimum length should be set to 10 in the
  dashboard so that a caller bypassing the app meets the same floor. There is no breached-password check in the
  app.
- **Change** (Settings, Security): the current password is re-checked with `signInWithPassword`, the new one is
  set, and every other session is signed out.
- **Reset:**
  1. `/forgot-password` calls `resetPasswordForEmail` with `redirectTo = <site URL>/auth/confirm?next=/reset-password`
     and always shows "If an account exists for this email, a password reset link has been sent."
  2. `/auth/confirm` verifies the link, sets the `fm_recovery` cookie to the recovered user's id and redirects to
     `/reset-password`.
  3. `/reset-password` shows the form only when `fm_recovery` equals the session's user id. `resetPasswordAction`
     checks that again, so an ordinary logged-in session cannot set a password without the old one.
  4. The password is updated, the cookie is deleted and every session is signed out, including the recovery one.

  Covered with mocks in `tests/unit/server-actions.test.ts` ("will not set a password without a recovery session
  from this browser", "sets the password with a valid recovery session, then ends every session"). Not run
  against real Supabase Auth.

  One detail to be aware of: for `?code=` links (no `type`), `/auth/confirm` treats the link as a recovery when
  `next` is `/reset-password`. The code must still be valid and exchangeable in that browser, so this is only
  usable by the person the link was sent to.

### Open-redirect protection on `next`

Every `next` value goes through `safeNextPath()` in `src/lib/routes.ts` before it is used: in `loginAction`
(server side, before returning the destination), in `/auth/confirm`, and in the "Continue" link on
`/verify-email`. It accepts only values that start with a single `/`, contain no backslash or control character,
and still resolve to the same origin when parsed as a URL; anything else falls back to a fixed path. Tests:
`tests/unit/routes.test.ts` ("rejects anything that could leave the site"), `tests/unit/server-actions.test.ts`
("only ever redirects to a same-origin path"), `tests/components/auth-forms.test.tsx` ("never continues to an
external address").

## Authorization model

Defined in `supabase/migrations/20261008000600_rls_and_grants.sql` and the function migrations; described table by
table in [Supabase schema and policies](supabase-schema.md).

- **Privileges start from nothing.** The migrations revoke everything on tables and functions in `public` and
  `private` from `anon` and `authenticated`, then grant back specific items.
- **Tables are read-only to the browser.** `authenticated` gets `SELECT` only (on `board_invitations` only on a
  column list that excludes `token_hash`); `anon` gets `SELECT` on `templates` only. There are no `INSERT`,
  `UPDATE` or `DELETE` grants or policies.
- **RLS is enabled on every table**, including the two in `private`. Policies limit reads to: your own profile;
  published templates; boards you are a member of (or own, so Trash works); sharing settings of boards you own;
  members, objects, operations, snapshots, comments and activity of boards you are a member of; invitations you
  sent as owner or that are addressed to your verified email; join requests you made or that are on boards you
  own; your own cookie-consent records. `security_events`, `private.rate_limits` and `private.settings` have no
  policy at all, so the API roles cannot read them.
- **All writes are database functions.** Each is `SECURITY DEFINER` with `search_path = ''`, takes the acting
  user from `auth.uid()` and looks the caller's role up in `board_members`. No function accepts a user id for the
  actor.
- **`anon` can execute exactly one function**, `username_available`.
- **The `private` schema** holds helpers and bookkeeping. `authenticated` may execute four helpers that policies
  need (`is_board_member`, `is_board_owner`, `own_verified_email`, `board_id_from_topic`) and nothing else there.
  `private` must not be added to the API's exposed schemas.

These structural properties are asserted directly in `tests/db/account.test.ts` ("function exposure": no private
helper is callable, `anon` has one function, every `SECURITY DEFINER` function pins `search_path`, RLS is on for
every table, no policy is always-true, API roles have no write privilege).

### Roles

A board has exactly one `OWNER` (a unique index enforces it) and any number of `EDITOR`s and `VIEWER`s.

| Capability                                                                     | Owner | Editor | Viewer                                           |
| ------------------------------------------------------------------------------ | ----- | ------ | ------------------------------------------------ |
| Read the board, its objects, operation log, member list, comments and activity | Yes   | Yes    | Yes                                              |
| Record a PNG export in the activity feed                                       | Yes   | Yes    | Yes                                              |
| Change the canvas (`submit_operation`)                                         | Yes   | Yes    | No                                               |
| Add and edit own comments                                                      | Yes   | Yes    | Only if the owner turns on "Viewers can comment" |
| Delete own comments                                                            | Yes   | Yes    | Yes                                              |
| Duplicate the board into a private copy they own                               | Yes   | Yes    | No                                               |
| Leave the board                                                                | No    | Yes    | Yes                                              |
| Rename, delete, restore, purge                                                 | Yes   | No     | No                                               |
| Sharing mode, collaboration code, share link, invitations, join requests       | Yes   | No     | No                                               |
| Change roles (Editor or Viewer only), remove members, transfer ownership       | Yes   | No     | No                                               |

Nobody can edit or delete another person's comment, including the owner. Member lists returned to other members
contain name, username, avatar and role; email addresses are not included.

A non-member gets `BOARD_NOT_FOUND` whether the board is private, deleted or never existed. A member whose role is
too low gets `BOARD_ACCESS_DENIED`.

### Canvas write path

`submit_operation` is the only way to change the canvas. Beyond the role check it:

- rejects unknown operation and object types, and payloads over 65,536 bytes;
- refuses to touch an object id that belongs to another board (with a generic validation error);
- passes `props` through `private.sanitize_props`, which keeps only known keys with valid values and drops
  everything else (see [Output encoding and XSS](#output-encoding-and-xss));
- caps a board at 5,000 live objects and text at 5,000 characters per object;
- deduplicates on `(board_id, operation_id)`.

### Realtime

All five board topics are private channels authorised by policies on `realtime.messages`
(`20261008000700_realtime.sql`): members of any role may subscribe; clients may send only on `:presence` and
`:cursors`. Operations, comments and activity are emitted by the database functions after the change is stored,
so a client cannot forge them. The policies are tested in `tests/db/realtime.test.ts`; the WebSocket transport
is not. Two limits that follow from the design are listed under
[Known weaknesses](#known-weaknesses-and-untested-areas): presence and cursor identity is client-asserted, and a
removed member can keep listening until their token refreshes. More in [Realtime](realtime.md).

Incoming Realtime payloads are validated in the browser before they touch board state
(`parseServerOperation`, `parseCursor`, `parseCommentEvent`, `parseActivityEvent`), presence and cursors are shown
only for user ids that the server lists as members, and incoming cursor events are capped at 30 per second per
sender.

## Account enumeration defences

The aim is that these screens do not tell a stranger whether an email address has an account, or whether a board
exists. The exact messages:

| Situation                                                                                                                  | What the person sees                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login: wrong password, unknown email, deactivated account, or any other error                                              | "That email and password don't match. Check them and try again."                                                                                                        |
| Registration: any outcome other than those listed below, including "already registered"                                    | The "Check your inbox" screen: "If the details you entered can be used for a new account, we've sent a verification link. Open it on this device to finish setting up." |
| Forgot password                                                                                                            | "If an account exists for this email, a password reset link has been sent."                                                                                             |
| Resend verification                                                                                                        | "If that address has an account waiting to be verified, a new link is on its way."                                                                                      |
| Opening a board you cannot see, or one that does not exist                                                                 | "Board not found or access is unavailable."                                                                                                                             |
| Joining with a code or link that is wrong, malformed, disabled, for a deleted board, or for a Private or Invite-only board | "Board not found or access is unavailable."                                                                                                                             |
| Accepting an invitation that does not exist, is addressed to someone else, or is for a deleted board                       | "This invitation isn't available."                                                                                                                                      |
| Inviting an email address                                                                                                  | The same "Invitation created for …" result whether or not an account exists                                                                                             |

Deliberate exceptions, and why:

- **Usernames are public handles.** Registration says "That username is taken. Try another." and
  `username_available` is callable without signing in. This reveals that a username exists, not which email owns
  it.
- **"Verify your email address to use this feature."** on login. The code's reasoning is that Supabase reports
  an unconfirmed email only after the password matched. That is a statement about Supabase's behaviour and has
  not been checked against a live project.
- **Rate-limit and network errors** are shown as such on every form. They are not specific to an account.
- **Weak-password errors** on registration are shown against the password field.
- **An invitee who passes the addressee check** sees distinct messages for expired, revoked and already-accepted
  invitations.
- **A code or link for a "request access" board** returns "Request submitted", "Your request is waiting for
  approval" or "Access denied". Those confirm the board exists, which is the purpose of that sharing mode.

Tested with mocks or in the database: the generic login, registration, forgot-password and resend answers
(`tests/unit/server-actions.test.ts`, `tests/components/auth-forms.test.tsx`), the hidden private board
(`tests/db/boards.test.ts`, `tests/db/canvas.test.ts`), codes for private boards (`tests/db/sharing.test.ts`) and
identical invitation responses (`tests/db/invitations.test.ts`). **Response timing has not been examined**, here
or in Supabase Auth.

## Collaboration codes, share links and invitation tokens

All three are generated in the database from `gen_random_uuid()`.

|                | Collaboration code                                                                        | Share link                                        | Invitation                                                          |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Form           | `F-XXX-XXXX`, 7 symbols from a 32-character alphabet without `O`, `0`, `I`, `1` (35 bits) | 64 hex characters (two v4 UUIDs, 244 random bits) | 64 hex characters (244 random bits)                                 |
| Stored as      | Plain text in `board_sharing`, readable only by the owner                                 | SHA-256 hash only                                 | SHA-256 hash only                                                   |
| Shown          | To the owner, any time                                                                    | To the owner once, when created or regenerated    | To the owner once, when created or resent                           |
| URL            | Typed at `/join` (or `/join?code=…`)                                                      | `/join?token=…`                                   | `/invitations/accept?token=…`                                       |
| Expires        | No                                                                                        | No                                                | After 7 days (`private.settings.invitation_ttl_days`)               |
| Turned off by  | "Collaboration code" toggle, or regenerating                                              | "Share link" toggle, or regenerating              | Revoking, or resending (which replaces the token)                   |
| Who can use it | Any signed-in, verified user                                                              | Any signed-in, verified user                      | Only an account whose **verified email equals the invited address** |
| Most it grants | Viewer                                                                                    | Viewer                                            | The role the owner chose: Editor or Viewer, never Owner             |

What a code or share link does depends on the board's sharing mode, and is decided in `join_board`:

| Sharing mode                            | Result of a valid code or link                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Private                                 | "Board not found or access is unavailable."                                                                                                    |
| Invite only                             | "Board not found or access is unavailable."                                                                                                    |
| Anyone with the link can view           | Joins as Viewer                                                                                                                                |
| Anyone with the link can request access | Creates a join request; the owner approves it as Viewer or Editor, or rejects it. A rejection blocks new requests from that person for 7 days. |

A code or link is therefore a locator, not a credential: the role always comes either from the fixed Viewer
grant or from an explicit decision by the owner.

Invitations:

- Only the owner can create, resend or revoke them. Creating one moves a Private board to Invite only.
- **No email is sent.** The invitee sees the invitation under the bell in the app (matched by verified email),
  and the owner is shown a link to pass on by whatever means they choose.
- A forwarded link does not work for anyone else, because acceptance requires the caller's verified email to
  equal the invited address.
- Inviting the same address again renews the pending invitation instead of creating a second one.
- Accepting can raise a Viewer to Editor; it never lowers a role.

Things to keep in mind:

- **Tokens travel in query strings.** The pages set `no-referrer`, but the URL can still end up in browser history
  and in the hosting platform's request logs. Foreman's own logging never records them.
- **Hashes are unsalted SHA-256.** That is appropriate for 244-bit random tokens; it would not be for anything a
  person chose.
- **The collaboration code is short by design** (about 3.4 × 10^10 possibilities). Its protection is the lookup
  limit of 10 per 10 minutes per account, the fact that failures are recorded, and that a hit yields at most
  Viewer access on boards whose owners chose a link mode. The limit is per account, so someone with many verified
  accounts can try proportionally more.
- **Share links and codes do not expire.** Regenerate them to cut off old copies.

Tested in `tests/db/sharing.test.ts` and `tests/db/invitations.test.ts`.

## Rate limiting

### Limits enforced in the database

`private.rate_limits` keeps one fixed-window counter per user and action. Exceeding a limit raises `RATE_LIMITED`
("You're doing that too often. Wait a moment and try again."), except in `join_board`, which returns a status.

| Action key            | Limit             | Applies to                                    | Tested in `tests/db` |
| --------------------- | ----------------- | --------------------------------------------- | -------------------- |
| `operation`           | 600 per minute    | `submit_operation`                            | Yes                  |
| `comment`             | 60 per 10 minutes | `add_comment` and `update_comment` together   | Yes                  |
| `create_board`        | 30 per hour       | `create_board` and `duplicate_board` together | Yes                  |
| `join_lookup`         | 10 per 10 minutes | `join_board` (code or link)                   | Yes                  |
| `data_export`         | 5 per hour        | `export_my_data`                              | Yes                  |
| `invite`              | 30 per hour       | `create_invitation` and `resend_invitation`   | No                   |
| `invitation_response` | 30 per 10 minutes | `accept_invitation`                           | No                   |
| `regenerate_code`     | 20 per hour       | `regenerate_collaboration_code`               | No                   |
| `regenerate_link`     | 20 per hour       | `regenerate_share_link`                       | No                   |
| `export`              | 30 per 10 minutes | `record_board_export`                         | No                   |
| `avatar`              | 30 per hour       | `regenerate_avatar`                           | No                   |
| `cookie_consent`      | 20 per hour       | `record_cookie_consent`                       | No                   |
| `account_deletion`    | 5 per hour        | `request_account_deletion`                    | No                   |

Limitations you should know about:

- **Only calls that succeed are counted**, with one exception. The counter is updated inside the same transaction
  as the function, so when a function raises any error, its own increment is rolled back. `join_board` avoids
  this by returning statuses instead of raising, so failed code lookups do count (and are logged). For the other
  actions, a stream of failing calls is not slowed down by the limit. For example, repeated `accept_invitation`
  calls with wrong tokens are never counted. With 244-bit tokens that is not a practical guessing risk, but the
  limit should not be described as protecting that path.
- **The limits are per user, not per IP address,** and there is no global limit.
- **Not limited in the database:** all reads, `username_available` (callable anonymously), profile and
  notification-preference updates, role changes, member removal, ownership transfer, sharing settings, board
  rename/delete/restore/purge, revoking and declining invitations, deciding join requests, and deleting comments.
- **Presence and cursor messages** are throttled only by the sending client (one cursor message per 80 ms) and
  by a receiving-side budget in each browser. A modified client is bounded only by Supabase Realtime's own
  quotas.

These limits are exercised in the test database, one user at a time. **They have not been tested under real
load or real concurrency.**

### What relies on Supabase Auth

Sign-up, sign-in, token refresh and all email sending (verification, resend, password reset) are limited by
Supabase Auth's own settings, which the operator should review in the dashboard. Foreman adds no limit, lockout
or CAPTCHA of its own in front of them. It maps Supabase's rate-limit responses to the generic "too often"
message. The password re-check used by "change password" and "delete account" is an ordinary Supabase sign-in,
so it falls under the same limits. None of this has been observed against a live project.

## Security headers

Set for every path in `next.config.ts`. `X-Powered-By` is disabled.

| Header                       | Value                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | See below                                                                          |
| `X-Content-Type-Options`     | `nosniff`                                                                          |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                  |
| `X-Frame-Options`            | `DENY`                                                                             |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                      |
| `Strict-Transport-Security`  | `max-age=63072000; includeSubDomains` (production builds only)                     |

Content Security Policy in a production build:

| Directive                   | Value                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `default-src`               | `'self'`                                                                           |
| `script-src`                | `'self' 'unsafe-inline'`                                                           |
| `style-src`                 | `'self' 'unsafe-inline'`                                                           |
| `img-src`                   | `'self' data: blob:`                                                               |
| `font-src`                  | `'self'`                                                                           |
| `connect-src`               | `'self'` plus the Supabase project's `https://` origin and its `wss://` equivalent |
| `object-src`                | `'none'`                                                                           |
| `base-uri`                  | `'self'`                                                                           |
| `form-action`               | `'self'`                                                                           |
| `frame-ancestors`           | `'none'`                                                                           |
| `frame-src`                 | `'none'`                                                                           |
| `worker-src`                | `'self' blob:`                                                                     |
| `manifest-src`              | `'self'`                                                                           |
| `upgrade-insecure-requests` | present                                                                            |

In development the policy additionally allows `'unsafe-eval'` in `script-src` and `ws:` and `http://localhost:*`
in `connect-src`, and omits `upgrade-insecure-requests` and HSTS.

Notes:

- **The Supabase origins are read from `NEXT_PUBLIC_SUPABASE_URL` when the configuration is evaluated.** A build
  made without that variable produces `connect-src 'self'`, and the browser will then block every call to
  Supabase. Set the variable before building.
- No third-party origin appears anywhere in the policy. Fonts are self-hosted and avatars are served by the app.
- **`/api/avatar/…` tries to set its own, stricter CSP** (`default-src 'none'; style-src 'unsafe-inline';
sandbox`) in the route handler. When the production build was started locally and the response inspected, only
  the global policy was present on that response; the route's header did not take effect. The SVG is assembled
  from fixed fragments and a validated seed, so there is no injection path known, but the stricter header should
  not be relied on.

### The `'unsafe-inline'` trade-off

`script-src` allows inline scripts. That weakens the policy considerably: if an attacker found a way to inject
markup containing an inline `<script>` or an inline event handler, the CSP would not stop it from running. With
`'unsafe-inline'` present, the CSP's value against script injection is limited to blocking scripts loaded from
other origins, plus the non-script directives (`connect-src`, `frame-ancestors`, `form-action`, `base-uri`,
`object-src`), which still restrict where data can be sent and how the page can be framed.

It is there because Next.js emits inline bootstrap scripts, and the alternative, a per-request nonce, only works
for pages that are rendered dynamically: Next.js applies the nonce while rendering on the server, from the CSP
header of that request, and a prerendered page has no request to take it from (see
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`). This app enables Cache Components and
prerenders static shells, so a nonce-based policy would mean giving that up or restructuring how pages are
rendered. That work has not been done; it is listed as future work in the README.

`style-src 'unsafe-inline'` is needed because the canvas and several components set inline styles from React.

The headers have no automated test. They were read from `next.config.ts` and observed once by starting the
production build locally without Supabase configured.

## CSRF

There are no CSRF tokens in the app. State-changing requests are protected by the following, none of which has
an automated test here:

- **`SameSite=Lax` session cookies.** A cross-site `POST`, `fetch` or subresource request does not carry the
  session.
- **Server Actions.** Every state-changing call that goes through the Next.js server is a Server Action
  (`"use server"` in `src/lib/auth/actions.ts` and `src/lib/boards/actions.ts`). Next.js only accepts them as
  `POST` and compares the request's `Origin` with the `Host` (or `X-Forwarded-Host`), rejecting mismatches
  (documented in `node_modules/next/dist/docs/01-app/02-guides/data-security.md`). `serverActions.allowedOrigins`
  is not configured, so only the app's own host is accepted. Behind Render's proxy this depends on the forwarded
  host header being correct, which has not been verified on a deployment.
- **Direct calls to Supabase** from the browser authenticate with an `Authorization` header that the Supabase
  client builds from the session, not with an ambient cookie that a third-party page could ride on.
- **Route handlers are `GET` only.** `/api/health` and `/api/avatar/…` are public and have no side effects.
  `/auth/confirm` requires a valid one-time token or code; as with any emailed sign-in link, a person who opens
  someone else's valid link ends up signed in to that other account in their browser. `/api/account/export` is
  the one `GET` with side effects: it uses one of the five hourly exports and writes a `DATA_EXPORTED` security
  event. Because the cookies are `Lax`, a cross-site top-level navigation to it would be authenticated; the
  result would be a file download in the user's own browser, not a disclosure to the other site.
- **`form-action 'self'`, `frame-ancestors 'none'` and `X-Frame-Options: DENY`** stop the app's pages being
  framed or its forms being pointed elsewhere.

## Output encoding and XSS

- **User text is rendered as text.** Board text, comments, names, usernames and board titles are rendered through
  React as text nodes. There is no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in `src`.
  Canvas text sits in an SVG `<foreignObject>` as a `<span>` text node (`object-shape.tsx`); in-place editing uses
  a plain `<textarea>`.
- **Text is stored verbatim.** The database does not strip markup from text, on purpose: it is never interpreted
  as markup when displayed. Anything that consumes the JSON data export or the database directly must treat
  these strings as untrusted.
- **Style and geometry values are whitelisted in the database** by `private.sanitize_props`. Only these keys
  survive, and only with valid values:

  | Key                       | Accepted                                                         |
  | ------------------------- | ---------------------------------------------------------------- |
  | `text`                    | String, at most 5,000 characters                                 |
  | `fill`, `stroke`, `color` | `#rrggbb` or `transparent`                                       |
  | `strokeWidth`             | Number, 0 to 32                                                  |
  | `fontSize`                | Number, 8 to 200                                                 |
  | `textAlign`               | `left`, `center` or `right`                                      |
  | `bold`                    | Boolean                                                          |
  | `points`                  | Even-length array of at most 4,000 numbers, each within ±100,000 |

  Unknown keys (`href`, `onclick`, anything else) are dropped. Coordinates and sizes are numeric columns with
  range checks. The browser does not re-validate colours; it relies on this whitelist and on React setting them as
  attribute and style values.

- **Avatars** are generated SVGs served by the app. The database constrains `avatar_url` to
  `/api/avatar/(male|female)/<seed>`, the component refuses any other URL, the route validates style and seed,
  and nothing personal goes into the URL or the drawing.
- **Errors shown to people** come from a fixed catalogue (`src/lib/errors.ts`). Unknown failures collapse to
  "Something went wrong on our side. Try again in a moment."; database messages, SQL and stack traces are not
  passed through.

Tested: `tests/db/canvas.test.ts` ("drops unknown properties and unsafe values"), `tests/browser/board.spec.ts`
("renders hostile text as text, never as markup", in Chromium with two users),
`tests/components/board-panels.test.tsx` ("renders comment text as text, not markup"),
`tests/components/ui.test.tsx` ("refuses to load an avatar from anywhere but the local generator"),
`tests/unit/errors.test.ts`.

## Secrets and environment variables

| Variable                                                                    | Secret?              | Used by the app                                                                                      |
| --------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                  | No                   | Yes. Must be `https:` unless the host is `localhost` or `127.0.0.1`                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | No, public by design | Yes                                                                                                  |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`                               | No                   | Yes, to build the links in Auth emails                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                                                 | **Yes**              | **No.** Only the [account-purge runbook](#account-purge-runbook) uses it, from an operator's machine |
| `AVATAR_PROVIDER_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`       | Would be             | No                                                                                                   |
| `E2E_*`                                                                     | Yes (test passwords) | Only by `npm run test:e2e`                                                                           |

- `NEXT_PUBLIC_*` values are compiled into the browser bundle. Nothing secret may use that prefix.
- **The application has no server-only secret.** No code in `src` reads `SUPABASE_SERVICE_ROLE_KEY` or any other
  private variable; the anon key plus the user's session is the only credential the server uses. A comment in
  `src/lib/env.ts` mentions a `server-env.ts` module for server-only secrets; that file does not exist.
- **Do not set the service-role key on the hosting platform.** It bypasses Row Level Security, and nothing in
  the app needs it.
- `.env*` files are git-ignored except `.env.example`, which contains placeholders only.
- `/api/health` reports whether Supabase is configured as a boolean and nothing else.

## Logging and security events

### Server logs

`src/lib/log.ts` is the only logging helper. `logServerError(scope, error, requestId?)` writes one JSON line to
standard error with exactly these fields:

| Field       | Content                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `level`     | `"error"`                                                                                 |
| `scope`     | A fixed string chosen by the caller, such as `auth.register`                              |
| `code`      | The normalised Foreman error code                                                         |
| `upstream`  | The upstream error's `code` if it is a string (for example a Postgres or Auth error code) |
| `requestId` | A random UUID when the caller supplies one                                                |
| `at`        | Timestamp                                                                                 |

It never writes the upstream error **message**, because messages can echo user input. It does not redact
anything, because it is not given anything to redact: callers pass only the error object and a scope. Request
bodies, cookies, tokens, passwords, email addresses and board content are not passed to it. That is a convention
held by the call sites and by code review, not something the function enforces. One test checks it for
registration (`tests/unit/server-actions.test.ts`, "never returns or logs the password or the email address").

What the hosting platform and Supabase log on their own (request URLs, IP addresses, Auth audit entries) is
outside the app's control. Note again that invitation and share-link tokens are in URLs.

### `security_events`

A table for security-relevant actions, kept apart from board activity. It has RLS enabled and no policy, so it
cannot be read through the API by anyone; an operator reads it with the SQL editor. Rows are written only by
database functions:

| Event                        | Written when                                                                 | Metadata                                              |
| ---------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| `JOIN_LOOKUP_FAILED`         | A code or link did not resolve, or resolved to a board whose mode forbids it | `via` (`code`, `link`, `invalid`), sometimes `reason` |
| `JOIN_RATE_LIMITED`          | The lookup limit was hit                                                     | none                                                  |
| `MEMBER_ROLE_CHANGED`        | An owner changed a member's role                                             | board id, user id, role                               |
| `OWNERSHIP_TRANSFERRED`      | Ownership was transferred                                                    | board id, new owner id                                |
| `BOARD_PURGED`               | A board was deleted forever                                                  | board id                                              |
| `DATA_EXPORTED`              | A data export was produced                                                   | none                                                  |
| `ACCOUNT_DELETION_REQUESTED` | An account was deactivated                                                   | none                                                  |

Limits: sign-in attempts, password changes and resets are **not** recorded here (Supabase Auth keeps its own
logs). The code or token that was tried is not stored. There is no alerting, no review screen and no retention
or clean-up job; the table grows until an operator prunes it. Board activity metadata is checked not to contain
secrets or board text (`tests/db/comments-activity.test.ts`).

## Image upload

**Image upload is not implemented.** There is no upload endpoint, no storage bucket and no code path that
accepts a file.

- **The tool is hidden.** The tool rail has no image tool, and `IMAGE` is not among the object types the client
  knows (`src/lib/board/types.ts`).
- **The database rejects image objects.** `submit_operation` raises `IMAGE_UPLOAD_DISABLED` ("Image uploads
  aren't available yet.") for any attempt to create an object of type `IMAGE`, whoever calls it. Template seeding
  skips `IMAGE` items and board duplication does not copy them. Since the browser has no direct write privilege
  on `canvas_objects`, there is no other way to create one. Tested in `tests/db/canvas.test.ts` ("keeps image
  objects disabled until secure upload exists").
- **The metadata table exists but has no insert path.** `uploaded_files` fixes the intended contract in its
  check constraints (MIME type one of `image/png`, `image/jpeg`, `image/webp`; size 1 to 5,242,880 bytes; width
  and height 1 to 4,096; a unique UUID `storage_key`). Members could read it; nothing can write to it.

Requirements that must all be met before the feature is enabled:

1. **PNG, JPEG and WebP only.** No SVG, no GIF, no other type.
2. **Validate the content, not the label.** Check the file signature (magic bytes) on the server and reject any
   mismatch with the declared type. Do not trust the extension or the `Content-Type` the client sent.
3. **Size limit of 5 MB**, enforced on the server before the file is stored.
4. **Dimension limit of 4096 × 4096 pixels**, read from the decoded image header on the server.
5. **A private storage bucket.** No public bucket and no public URLs.
6. **UUID object keys** generated by the server. The original file name is never used as a path.
7. **Short-lived signed URLs** for display, issued only to board members after a membership check.
8. **Rate limits** on uploads per user and per board, in the same mechanism as the other limits.
9. **A row in `uploaded_files` for every stored object**, written by a database function that checks the
   caller's role, so storage and metadata cannot drift apart and deleting a board removes its files.

Also required when the time comes: add the storage origin to `img-src` (today it is `'self' data: blob:`),
decide whether to re-encode images to strip metadata, include images in PNG export deliberately rather than by
accident, and cover all of it with tests in `tests/db` before the tool is shown.

## PNG export

Export happens entirely in the browser (`src/lib/board/export.ts`). The board is redrawn onto an off-screen 2D
canvas from the object data and saved with a download link. No server is involved in producing the image.

| Included                                                              | Not included                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Sticky notes, text, rectangles, circles, arrows and freehand drawings | Deleted objects                                                      |
| Their text, colours and stacking order                                | The side panel, toolbars and any other interface                     |
| A plain background (`#FCFAF6`)                                        | Member names, avatars, email addresses                               |
| Either the whole board with a margin, or the area currently on screen | Comments and activity                                                |
|                                                                       | Other people's cursors, selection outlines and handles, the dot grid |

- The image is capped at 8,192 pixels per side and 16 million pixels; larger boards are scaled down.
- Any member, including a viewer, can export, because they can already read everything that is drawn.
- After a file has been produced the client calls `record_board_export`, which adds "exported the board as a PNG"
  to the activity feed. This is a record made by the client after the fact: a modified client could export
  without recording, or record without exporting. It is not an audit control.
- Text is laid out by a separate routine and can wrap slightly differently from the screen.

Tested in `tests/browser/board.spec.ts` ("downloads a real PNG of the canvas and records the export", "excludes
other people's cursors and the panels from the image") and `tests/unit/board-utilities.test.ts`.

## Account deletion, data export and retention

### Data export

Settings, "Privacy and data", "Download data export" requests `GET /api/account/export`, which calls
`export_my_data()` and returns a JSON attachment with `Cache-Control: no-store`. The function takes no
parameters; it uses the session's user id. It contains the caller's profile, every board they are a member of
with its current objects (plus their own boards in Trash), the comments they wrote, and up to 2,000 recent
activity entries from boards they are on. It is limited to five per hour and records `DATA_EXPORTED`.

Note that the export contains other members' board content on shared boards, because the caller can already read
it. It does not contain other people's email addresses.

### Account deletion

Settings, "Privacy and data", "Delete my account" asks for the password and the phrase `DELETE MY ACCOUNT`.
`deleteAccountAction` re-checks the password with Supabase Auth, calls `request_account_deletion`, then signs
out every session. The database function, in one transaction:

1. refuses with `OWNED_BOARDS_REQUIRE_TRANSFER` if the user owns any live board that other people are on;
2. moves every board the user owns to Trash (soft delete);
3. removes the user from boards they do not own;
4. revokes pending invitations the user sent and deletes their pending join requests;
5. sets the profile to `PENDING_DELETION` with a `deleted_at` timestamp;
6. records `ACCOUNT_DELETION_REQUESTED`.

After that, the app's login refuses the account with the generic credentials message, the data-access layer
treats it as signed out, and every function that requires a verified, active user raises `ACCOUNT_INACTIVE`.

**This is deactivation, not erasure.** What remains until an operator purges the account:

- the `auth.users` row (email address, password hash) and the `profiles` row (name, username, email);
- the user's own boards, in Trash, with all content;
- comments and canvas content they contributed to other people's boards, still attributed to them;
- activity entries, security events and cookie-consent records.

And one gap: **the account is not blocked at the Auth layer.** Someone who knows the password can still obtain a
session directly from Supabase Auth (the anon key is public). With it they cannot change or join anything, but
they can read their own profile and their boards in Trash, call `export_my_data`, and call
`update_notification_prefs`. The first step of the runbook closes this.

Tested: the database behaviour in `tests/db/account.test.ts`; the action's order of operations with mocks in
`tests/unit/server-actions.test.ts`.

### Retention

There is no automatic retention or purge anywhere in the code: no scheduled job, no expiry of trashed boards, no
pruning of `board_operations`, `board_activity`, `security_events` or `cookie_consents`. Trashed boards stay
until their owner chooses "Delete forever" or an operator removes them. Deactivated accounts stay until an
operator runs the runbook below. The privacy page says the retention period is the operator's to set and state;
the software does not set one.

### Account purge runbook

Final removal of a deactivated account is a manual operator task. It is done **from an operator's machine**, with
the Supabase dashboard or the admin API. It is never done by the application, and the service-role key is never
placed in the app's environment.

**This runbook has not been executed against a real Supabase project.** The SQL and the foreign-key behaviour it
relies on were checked against the migrations in the in-process test database. Try it on a staging project first.

Before you start: the SQL editor runs with full privileges and bypasses Row Level Security. Work on one account
at a time, read each result before running the next statement, and take a backup first if the project's plan
provides one.

1. **Find the accounts that are due.** Choose your retention period and substitute it.

   ```sql
   select id, email, username, deleted_at
   from public.profiles
   where status = 'PENDING_DELETION'
     and deleted_at < now() - interval '30 days';
   ```

   Never purge an account whose status is `ACTIVE`. Use the `id` from this result as `<user-id>` below.

2. **Block sign-in.** In the dashboard, open Authentication, Users, find the user and ban them. (With the admin
   API this is `auth.admin.updateUserById('<user-id>', { ban_duration: '…' })`.) Do this as soon as an account is
   deactivated if you want to close the gap described above, rather than waiting for the retention period.

3. **Review the boards the user owns.**

   ```sql
   select b.id, b.title, b.deleted_at,
          (select count(*) from public.board_members m
            where m.board_id = b.id and m.user_id <> b.owner_id) as other_members
   from public.boards b
   where b.owner_id = '<user-id>';
   ```

   Every row should have a `deleted_at`. If any row has `deleted_at` null, stop: the account was not deactivated
   through the app. If `other_members` is above zero, the board was already in Trash when the account was
   deactivated and other people are still attached to it; deleting it removes it for them permanently. Decide
   whether that is acceptable before continuing.

4. **Decide what happens to their comments on other people's boards.** After the purge these comments remain,
   shown as written by "A former member", and can no longer be traced to the user. If your policy is to remove
   them, it must be done now, while they can still be identified:

   ```sql
   delete from public.board_comments where author_id = '<user-id>';
   ```

5. **Delete the boards the user owns.** This is required: `boards.owner_id` uses `ON DELETE RESTRICT`, so the
   user cannot be deleted while any board row, including one in Trash, still names them as owner.

   ```sql
   delete from public.boards where owner_id = '<user-id>';
   ```

   This cascades to each board's sharing settings, members, invitations, join requests, objects, operation log,
   snapshots, comments and activity.

6. **Delete the user in Supabase Auth.** In the dashboard: Authentication, Users, delete the user. Or, from your
   own machine with the service-role key in a local environment variable:

   ```js
   // Run locally. Never deploy this, and never commit the key.
   import { createClient } from "@supabase/supabase-js";

   const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
     auth: { persistSession: false },
   });
   const { error } = await admin.auth.admin.deleteUser("<user-id>");
   if (error) throw error;
   ```

   Deleting the `auth.users` row removes the `profiles` row (`ON DELETE CASCADE`), and with it the user's
   remaining memberships, the invitations they sent, their join requests and their cookie-consent records.
   References from other people's data are set to null: `created_by` and `updated_by` on objects, `actor_id` on
   operations and activity, `author_id` on comments, `user_id` on security events, `accepted_by` on invitations,
   `decided_by` on join requests.

   If this step fails with a foreign-key error on `boards_owner_id_fkey`, step 5 was not completed.

7. **Remove what the foreign keys do not reach.**

   ```sql
   -- Rate-limit counters have no foreign key.
   delete from private.rate_limits where user_id = '<user-id>';

   -- Invitations other owners addressed to this person's email address remain. Review, then delete if required.
   select id, board_id, status, created_at from public.board_invitations where invitee_email = '<email>';
   ```

8. **Verify.**

   ```sql
   select count(*) from auth.users where id = '<user-id>';       -- expect 0
   select count(*) from public.profiles where id = '<user-id>';  -- expect 0
   select count(*) from public.boards where owner_id = '<user-id>'; -- expect 0
   ```

9. **Record the purge** in your own operations log (who, when, which user id). The app keeps no record of it.

What still remains afterwards, and cannot be tied to a name or email inside Foreman any more:

- content the person added to other people's boards (objects and their text), now with no author;
- comments, unless removed in step 4;
- the bare user UUID inside historical JSON: `board_operations.object_state` and `board_snapshots.state` embed
  `created_by` / `updated_by`, and some `board_activity` and `security_events` metadata holds a `user_id`;
- the username, which becomes available for someone else to register;
- anything in Supabase's own Auth logs, backups and the hosting platform's logs, under those providers'
  retention.

## Cookie consent

Foreman sets only essential cookies: the Supabase session cookies and `fm_recovery`. **No analytics, advertising
or tracking code is loaded**, and the CSP allows no third-party origin from which such code could be loaded.

The consent banner exists so that an optional category, if one is ever added, is off by default.

- The banner offers "Accept optional cookies", "Reject optional cookies" and "Manage preferences". The dialog has
  three switches: Essential (always on, disabled), Preferences and Analytics (both off by default, both described
  as not in use).
- The choice is stored in `localStorage` under `foreman:cookie-consent` as
  `{ version, analytics, preferences, decidedAt }`. The current version is `2026-10`; a choice made under another
  version is treated as no choice, so the banner returns.
- For a signed-in user the choice is also appended to the `cookie_consents` table (user id, version, the two
  booleans, timestamp) through `record_cookie_consent`. Each change adds a row; rows are readable only by their
  owner and are removed when the account is purged. Signed-out visitors' choices stay in the browser only.
- `mayLoadAnalytics()` in `src/lib/consent.ts` is the gate a future optional script would have to pass. Nothing
  calls it today because there is nothing to load.

Tested in `tests/unit/avatar-consent-plans.test.ts`, `tests/components/app.test.tsx` and
`tests/db/account.test.ts`.

## Known weaknesses and untested areas

Not verified at all:

- **Nothing has run against a live Supabase project or a deployment.** Supabase Auth behaviour (sign-up,
  confirmation, sign-in, reset, rate limits, which errors it returns when), the Realtime transport, real cookie
  behaviour in browsers, and the app behind Render's proxy are all unobserved.
- **The database tests use PGlite with a hand-written stand-in** for Supabase's `auth` and `realtime` schemas.
  They prove the migrations' logic, not that a hosted project behaves identically (default privileges, the real
  `realtime.send`, PostgREST's exposure rules).
- **No test covers the response headers, CSRF handling or cookie attributes.**
- **No penetration test, dependency audit in CI, load test or timing analysis** has been done.

Design limits:

- **`script-src` keeps `'unsafe-inline'`**, so the CSP is not an effective second line of defence against script
  injection.
- **Session cookies are readable by JavaScript** and do not carry an explicit `Secure` attribute.
- **Presence and cursor identity is asserted by the client.** Only members can join the channels and only members
  are ever displayed, but one member can make another member appear online or move a cursor under their name.
  Operations, comments and activity cannot be forged this way.
- **A removed member can keep listening on Realtime** until their access token is refreshed. Writes and page
  loads are refused immediately.
- **Issued access tokens stay valid until they expire**, including after "sign out everywhere".
- **Rate limits count successful calls only** (except code and link lookups), are per user rather than per IP,
  and do not cover several write functions or any read.
- **`username_available` is callable anonymously and unlimited**, so usernames can be enumerated.
- **Collaboration codes are short and never expire; share links never expire.**
- **Tokens are carried in URLs** and may appear in history and platform logs.
- **A deactivated account is not blocked at the Auth layer**, and removal of its data is manual.
- **No automatic retention** for trashed boards, operation logs, activity, security events or consent records.
- **The pending-edit queue in `localStorage` survives logout.**
- **The avatar route's own CSP header does not take effect.**
- **The export activity entry is client-reported.**
- **There is no alerting or review screen for `security_events`**, and Auth events are not in it.
- **Individual sessions cannot be listed or revoked**; only "sign out everywhere" exists.
- **No multi-factor authentication, CAPTCHA, account lockout or breached-password check** exists in the app.
- **No email is sent for invitations**, so the app cannot notify someone outside it; the owner must pass the
  link on, and the channel they use is outside Foreman's control.

## No compliance claims

Nothing in this document, the application or its legal pages is a claim of compliance with any law, regulation
or standard, or a statement that the software is secure. The privacy, cookie and terms pages describe what the
software does; they are not legal advice and have not been reviewed by a lawyer. An operator who deploys Foreman
is responsible for their own assessment, including retention periods, lawful basis, processor agreements with
Supabase and the hosting provider, and breach procedures.
