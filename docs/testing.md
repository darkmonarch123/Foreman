# Testing

Foreman has five test suites. Four run with no external services and have been run locally; the fifth needs a
real Supabase project and has not been run. This document says, for each suite, what it runs against, what a
pass proves, and what it does not prove.

## Summary

| Suite            | Directory          | Runner                          | Runs against                                                   | Tests | Status                                |
| ---------------- | ------------------ | ------------------------------- | -------------------------------------------------------------- | ----- | ------------------------------------- |
| Unit             | `tests/unit`       | Vitest (Node)                   | Pure modules; Supabase and Next.js mocked at module boundaries | 140   | Passing locally                       |
| Component        | `tests/components` | Vitest + Testing Library, jsdom | React components with Server Actions mocked                    | 89    | Passing locally                       |
| Database         | `tests/db`         | Vitest + PGlite                 | The real migrations in an in-process Postgres                  | 131   | Passing locally                       |
| Browser          | `tests/browser`    | Playwright, Chromium            | The real board UI and sync engine with an in-memory backend    | 35    | Passing locally                       |
| End to end (e2e) | `tests/e2e`        | Playwright, Chromium            | A running Foreman and a real Supabase project                  | 3     | **Written, never run.** Skipped today |

The three Vitest suites together are the 360 tests that `npm run test` runs.

### Commands

```bash
npm run test            # unit + component + database (vitest run)
npm run test:unit       # tests/unit and tests/components
npm run test:db         # tests/db only
npm run test:browser    # Playwright project "board"
npm run test:e2e        # Playwright project "e2e" (skipped without E2E_* variables)
npm run check           # format:check, lint, typecheck, test, build (does not include the Playwright suites)
```

Static checks, also part of `npm run check`:

```bash
npm run format:check    # prettier --check .
npm run lint            # eslint
npm run typecheck       # next typegen && tsc --noEmit
npm run build           # next build
```

A single file or test: `npx vitest run tests/db/canvas.test.ts`, `npx vitest run -t "stale text edit"`,
`npx playwright test --project=board tests/browser/board.spec.ts`.

### What is and is not covered, in one paragraph

The database rules (schema, RLS, every function, realtime channel policies) are tested against the real SQL.
The board UI and its sync engine are tested in a real browser. Forms, validation, Server Actions and route
protection are tested with Supabase mocked. **Nothing that has been run so far has contacted Supabase Auth,
PostgREST or the Realtime server, and nothing has run the Next.js server together with a database.** The e2e
suite exists to close that gap and needs a project to run against.

## Vitest configuration

`vitest.config.mts` applies to the unit, component and database suites:

- test files match `tests/**/*.test.{ts,tsx}`;
- the default environment is `node`; component test files opt into jsdom with a `// @vitest-environment jsdom`
  comment on their first line;
- `@` resolves to `src`;
- `server-only` resolves to an empty module (`tests/support/empty-module.ts`), because the real package throws
  outside a React Server environment;
- `tests/support/setup.ts` loads the jest-dom matchers and unmounts rendered components after each test;
- timeouts are 30 s per test and 60 s per hook (the database suites apply all migrations in `beforeAll`);
- `restoreMocks` is on.

## Unit tests (`tests/unit`)

**Runs against:** TypeScript modules in `src/lib`, in Node. No browser, no database, no network.

| File                           | Subject                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `board-engine.test.ts`         | `BoardEngine` with an in-memory server (`tests/support/fake-board-server.ts`) and fake timers. |
| `board-reducer.test.ts`        | The pure reducer: load, apply, gap detection, optimistic projection.                           |
| `board-utilities.test.ts`      | Geometry, export planning and drawing, realtime payload validators, pending storage, backoff.  |
| `server-actions.test.ts`       | Auth, account and board Server Actions.                                                        |
| `proxy.test.ts`                | `updateSession()`: redirects, cookie pass-through, fail-closed behaviour.                      |
| `routes.test.ts`               | Route classification and `safeNextPath()`.                                                     |
| `schemas.test.ts`              | Zod schemas for registration, login, recovery, boards, comments.                               |
| `errors.test.ts`               | `toAppError()` mapping and the `apiErrorBody()` format.                                        |
| `avatar-consent-plans.test.ts` | Avatar generation, cookie-consent records, plan entitlement, `getPublicEnv()`.                 |
| `template-seed.test.ts`        | The template catalog, and that the seed migration matches it.                                  |

How the mocking works:

- `server-actions.test.ts` replaces `@/lib/supabase/server` with an object whose `auth.*`, `rpc` and
  `from().select().eq().maybeSingle()` are spies, replaces `@/lib/auth/dal` so the test sets the current
  profile, and replaces `next/navigation`, `next/cache` and `next/headers`.
- `proxy.test.ts` replaces `@supabase/ssr` so that `getClaims()` returns what the test chooses.
- `board-engine.test.ts` connects several engines to one `FakeBoardServer`, which follows the same rules as
  `submit_operation` (sequencing, deduplication, deletion wins, text version check) and can fail on demand or
  withhold broadcasts.

**Proves:**

- the engine's behaviour: optimistic rendering, ordered sending, acknowledgement, gap recovery, retry with
  backoff, re-sending stored operations after a reload without double application, blocking failures, conflict
  handling, undo and redo;
- what each Server Action sends to Supabase, what it refuses before sending, and that login, registration,
  recovery and resend responses do not reveal whether an account exists;
- that actions never pass a caller-chosen user id;
- route protection decisions and open-redirect rejection;
- the error mapping and response formats.

**Does not prove:**

- anything about Supabase's real responses. The mocks return what the test author expects Supabase to return.
  If a real error has a different `code` or shape, `toAppError()` may classify it differently;
- that the proxy actually runs for the paths in its `matcher` under Next.js;
- that `FakeBoardServer` and the SQL function agree. That agreement is by construction and review; the SQL is
  tested separately in `tests/db/canvas.test.ts`.

## Component tests (`tests/components`)

**Runs against:** React components rendered into jsdom with Testing Library and `user-event`. `next/navigation`
and `next/link` are replaced by the stand-ins in `tests/support/next-mocks.tsx`. The Server Action modules
(`@/lib/auth/actions`, `@/lib/boards/actions`) are replaced by spies, so no action code runs.

| File                    | Subject                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `auth-forms.test.tsx`   | Register, login, forgot-password and reset-password forms; the verify-email states.                |
| `app.test.tsx`          | Create-board form, template gallery, join form, invitation acceptance, board card, cookie consent. |
| `board-panels.test.tsx` | People, Comments, Activity and Outline panels.                                                     |
| `ui.test.tsx`           | Primitives: button, badges, avatar, input, modal, tabs, dropdown menu, toast, empty state.         |

**Proves:** client-side validation and error display, what each form passes to its action, loading, empty and
error states, role-dependent controls, that user text is rendered as text, and the accessibility contracts of
the primitives (roles, labels, focus trapping and return, keyboard patterns).

**Does not prove:** layout, real focus rendering or anything visual (jsdom has no layout engine); that the
forms work with the real actions; Server Components, which are not rendered here.

## Database tests (`tests/db`)

**Runs against:** [PGlite](https://pglite.dev), a WebAssembly build of Postgres that runs inside the Node
process. There is no database server to install or start.

### The harness

`tests/db/harness.ts` exports `TestDatabase`:

- `TestDatabase.create()` starts a fresh PGlite instance, executes `tests/db/supabase-shim.sql`, then executes
  every `.sql` file in `supabase/migrations` in filename order. These are the same files that would be applied
  to a real project; a migration that fails to apply fails the suite. Each test file creates its own database
  in `beforeAll`.
- `createUser()` inserts into `auth.users` the way Supabase Auth would, which fires the real signup trigger that
  creates the profile.
- `rpc(user, fn, args)` calls a function in `public` with named arguments after `set role authenticated` and
  setting `request.jwt.claims` to `{ sub, role }`. With `user = null` it runs as `anon`.
- `queryAs(user, sql)` runs arbitrary SQL under the same role switch, to prove what direct table access can and
  cannot do.
- `withTopic(user, topic, sql)` additionally sets the `realtime.topic` setting, to evaluate the policies on
  `realtime.messages` the way Realtime does when a client joins or sends on a private channel.
- `admin(sql)` runs as the database owner, for fixtures and assertions only.

`tests/db/fixtures.ts` builds a board with an owner, an editor and a viewer who joined through real invitations,
plus an outsider, and has helpers to assert a specific Foreman error code (`expectCode`) or a privilege/RLS
denial (`expectDenied`).

### What the shim replaces

A real Supabase project provides roles, the `auth` schema and the `realtime` schema before any migration runs.
PGlite has none of them, so `tests/db/supabase-shim.sql` creates the minimum the migrations depend on. It is
never applied to a real database.

| Shimmed                                         | In the shim                                                                          | Difference from real Supabase                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Roles `anon`, `authenticated`, `service_role`   | Created with `nologin`; `service_role` has `bypassrls`.                              | Same names and intent. Any other grants or settings Supabase gives these roles are absent.                                 |
| `auth.users`                                    | A six-column table (id, email, metadata, confirmed/last-sign-in/created timestamps). | The real table has many more columns and is written by the Auth service. Only the columns the migrations read are present. |
| `auth.uid()`                                    | Reads `sub` from `request.jwt.claim.sub` or `request.jwt.claims`.                    | Same mechanism, but the claims are set by the test with `set_config`. No JWT is issued, signed or verified.                |
| `realtime.messages`                             | A plain table with RLS enabled.                                                      | Stands in for Supabase's own table. Its exact columns and storage are not reproduced.                                      |
| `realtime.topic()`                              | Reads the `realtime.topic` setting.                                                  | Set by the test instead of by the Realtime server.                                                                         |
| `realtime.send(payload, event, topic, private)` | Inserts a row into `realtime.messages`.                                              | Nothing is delivered to anyone. Tests assert on the inserted row.                                                          |
| Default privileges on `public`                  | `grant all` on new tables, functions and sequences to the three roles.               | Reproduces Supabase's permissive defaults so the tests prove that the migrations revoke them.                              |

### What a pass proves

- The migrations apply cleanly, in order, to an empty Postgres with the shim.
- Row Level Security and privileges: what each role can select, that every direct table write is refused, that
  private helpers are not callable by API roles, that `anon` can execute exactly one function, that every
  `SECURITY DEFINER` function pins `search_path`, and that RLS is enabled on every application table.
- Every public function's behaviour and authorization: boards, membership, invitations, collaboration codes and
  share links, join requests, canvas operations, comments, activity, profiles, avatars, data export, account
  deletion, rate limits.
- `submit_operation` in detail: role checks, validation and sanitising, gap-free sequencing, deduplication,
  each conflict rule, snapshots and recovery, and that the broadcast row is written with the operation.
- The realtime policies: members of a board may listen on its five topics, may send only presence and cursors,
  and non-members, anonymous users and members of other boards may do neither.

### What a pass does not prove

- **Auth.** Sign-up, login, email delivery, token issue and refresh, and password rules are Supabase Auth's
  job. The shim only imitates the row Auth would insert.
- **PostgREST.** Functions are called with SQL, not over HTTP. Exposed-schema configuration, argument and
  result JSON conversion and the error objects `supabase-js` returns are not exercised.
- **Realtime delivery.** The tests show that the policies give the right answer and that the database writes
  the right message. They do not show that the Realtime server evaluates those policies as assumed, delivers
  messages, tracks presence, or caches authorization the way [Realtime](realtime.md) describes.
- **Concurrency.** PGlite is a single in-process connection. Tests that say "concurrent" submit operations one
  after another in a chosen order. The row locks in `submit_operation` are never contended, so behaviour under
  truly simultaneous writers is argued from the code, not observed.
- **Postgres version and platform.** PGlite's Postgres build is not the hosted one. Differences in version,
  extensions or settings would not show up here.
- **The migration tooling.** `supabase db push` and the SQL editor have not been used; the files are executed
  directly.

Run with `npm run test:db`.

## Browser tests (`tests/browser`)

**Runs against:** the real `BoardWorkspace` component tree and `BoardEngine`, in Chromium, served by Vite, with
an in-memory backend in place of Supabase.

### The harness

```
Playwright test (Node)                          Chromium page(s)
  fixtures.ts                                     harness/index.html + main.tsx
    FakeBackend (HTTP + SSE, random port)  <---->   createHttpBoardServices()  ->  BoardWorkspace
    control(): reset, fail-next,                    (same component the app renders)
      drop-operation-events, state
Vite dev server on 127.0.0.1:4317 serves the harness page
```

- **`playwright.config.ts`** starts `npx vite --config tests/browser/vite.config.mts` as its web server and
  waits for `http://127.0.0.1:4317`. Outside CI an already-running server on that port is reused.
- **`tests/browser/vite.config.mts`** builds the board from `src` with a few modules swapped for stand-ins:
  `next/link` and `next/navigation` (`stubs/next-link.tsx`, `stubs/next-navigation.ts`, which record
  navigations instead of performing them), `@/lib/auth/actions` (`stubs/auth-actions.ts`) and `server-only`.
  A small plugin serves generated avatars at `/api/avatar/...` using the app's own generator.
- **`tests/browser/harness/main.tsx`** reads `?backend=<url>&user=ada|ben|vic`, fetches the board state and
  members from the backend, and mounts `BoardWorkspace` with `createHttpBoardServices()` as its
  `BoardServices`.
- **`tests/browser/harness/http-services.ts`** implements `BoardServices` over `fetch` and `EventSource`.
  Incoming events pass through the same validators the Supabase implementation uses (`parseServerOperation`,
  `parseCursor`, `parseCommentEvent`, `parseActivityEvent`).
- **`tests/browser/fake-backend.ts`** is a Node HTTP server with three seeded members (Ada the owner, Ben the
  editor, Vic the viewer) and one board. It wraps the same `FakeBoardServer` the engine unit tests use, adds
  comments, activity, sharing, invitations and membership, pushes events to connected pages over Server-Sent
  Events, and derives presence from open event streams. Test-only endpoints under `/__test/` reset it, make the
  next calls fail with a chosen error code, drop operation events, or return its state for assertions.
- **`tests/browser/fixtures.ts`** starts one backend per worker, resets it before each test to a board seeded
  from the Project Roadmap template, and provides `openBoard(user)`, which opens a page and waits for the canvas
  and the "Connected" indicator. Several users are several pages.

### Spec files

| File                    | Tests | Covers                                                                                                              |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `board.spec.ts`         | 26    | Editing, collaboration between pages, roles, offline and recovery, PNG export, activity.                            |
| `accessibility.spec.ts` | 9     | Outline panel, mouse-free editing, focus trapping, labelled controls, shortcuts, context menu, live regions, focus. |

### What a pass proves

- The board works in a real browser: pointer gestures, keyboard shortcuts, in-place text editing, drawing,
  zoom and pan, selection, the object toolbar, the command palette and context menu.
- The engine and UI together: optimistic updates, the durable queue in `localStorage` (inspected directly),
  saving after going offline and back (`context.setOffline`), surviving a reload with unsent work, catching up
  after dropped events, the persistent failure banner, and the text-conflict message.
- Two or three simultaneous users see each other's edits, presence, cursors and comments.
- A viewer gets a read-only board; a removed member is told so.
- PNG export produces a real PNG that contains the canvas and not the panels or other people's cursors.
- Keyboard and assistive-technology access as described in [Accessibility](accessibility.md).

### What a pass does not prove

- **Nothing about Supabase.** `src/lib/board/supabase-services.ts` is not executed, apart from its validators.
  Channel subscription, `setAuth`, presence tracking, cursor throttling over a real socket and RPC error shapes
  are untested here.
- **The backend's rules are a re-implementation.** They mirror the database functions but are separate code.
  Authorization in particular is the fake's, not RLS.
- **The transport differs.** Events arrive over Server-Sent Events from one process, in order. Real Realtime
  uses WebSockets and five separate channels.
- **Not the Next.js app.** The page is served by Vite. Server rendering, the proxy, Server Actions, the board
  page's loader and the Content-Security-Policy are not involved.
- **One browser.** Chromium only, at a 1440 x 900 viewport.

### Running

```bash
npx playwright install chromium     # once
npm run test:browser
```

Useful environment variables:

- `PLAYWRIGHT_CHROMIUM_PATH`: path to an existing Chromium or Chrome executable. When set,
  `playwright.config.ts` passes it as `launchOptions.executablePath` and no Playwright browser download is
  needed.
- `FOREMAN_SCREENSHOT_DIR`: if set, `accessibility.spec.ts` writes a few screenshots of the board into that
  directory.
- `CI`: enables one retry, the GitHub reporter, and a fresh Vite server.

Tests run serially with one worker. Traces are kept for failed tests under `test-results/`; open one with
`npx playwright show-trace <path-to-trace.zip>`.

## End-to-end tests (`tests/e2e`)

**Runs against:** a running Foreman instance and a real Supabase project. Nothing is mocked.

**Status:** written and type-checked, never executed. Until it has passed against your project, treat the
journey it describes as unverified.

`tests/e2e/journey.spec.ts` has three tests, run serially:

1. **Visitor pages.** The landing page renders, four protected URLs redirect to `/login`, and a wrong login
   shows the generic credentials error.
2. **Owner and collaborator on one board.** The owner logs in, creates a board from the Project Roadmap
   template, checks the collaboration code format, invites the collaborator as Editor, adds a sticky note and
   drags it. The collaborator logs in, accepts the invitation from the notifications menu and sees the note.
   The test then checks presence, the collaborator's cursor, a live edit in the other direction, a comment and
   its activity entry, a PNG download, presence disappearing when the collaborator leaves, persistence across
   navigation and reload, and that logging out closes the board and dashboard.
3. **A stranger cannot see the board.** The owner creates a board; the collaborator, who is not a member,
   gets the "Board not found or access is unavailable." page, and a wrong collaboration code gives the same
   generic answer. (The test's title also mentions a viewer; it contains no viewer assertions. Viewer
   restrictions are covered in `tests/db/canvas.test.ts` and `tests/browser/board.spec.ts`.)

### Preconditions

1. **A Supabase project** with every migration applied and Auth configured as in the
   [README](../README.md#supabase-setup).
2. **Foreman running against that project**, built or started with `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` set. Either locally:

   ```bash
   cp .env.example .env.local     # fill in the project URL and anon key
   npm run build && npm run start # http://localhost:3000
   ```

   or a deployed instance (see [Deployment on Render](deployment-render.md)). Playwright does not start the
   Next.js app for you.

3. **Two accounts that already exist and have verified email addresses**: an owner and a collaborator.
   Registration and verification are not automated because they need a mailbox. Create both by hand through the
   app, following the [demo script](demo-script.md), and click the verification link for each. Both must be
   able to log in and reach `/dashboard`. An unverified owner cannot create a board.
4. **Chromium** for Playwright: `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH`.
5. **Port 4317 free.** The Playwright configuration has a single `webServer` entry, so the Vite harness is
   started for the `e2e` project as well, although the e2e tests do not use it.

### Variables

| Variable                    | Required | Purpose                                                                   |
| --------------------------- | -------- | ------------------------------------------------------------------------- |
| `E2E_OWNER_EMAIL`           | Yes      | Email of the verified owner account.                                      |
| `E2E_OWNER_PASSWORD`        | Yes      | Its password.                                                             |
| `E2E_COLLABORATOR_EMAIL`    | Yes      | Email of the verified collaborator account. Must differ from the owner's. |
| `E2E_COLLABORATOR_PASSWORD` | Yes      | Its password.                                                             |
| `E2E_BASE_URL`              | No       | Origin of the running app. Defaults to `http://127.0.0.1:3000`.           |
| `PLAYWRIGHT_CHROMIUM_PATH`  | No       | Use this browser executable instead of Playwright's downloaded Chromium.  |

The suite is skipped unless all four required variables are non-empty. `E2E_BASE_URL` is not part of that
check. Playwright does not read `.env.local`; export the variables in the shell (the commented entries in
`.env.example` are a reminder of the names only).

### Running

```bash
export E2E_BASE_URL=http://127.0.0.1:3000
export E2E_OWNER_EMAIL=owner@example.com
export E2E_OWNER_PASSWORD='...'
export E2E_COLLABORATOR_EMAIL=collaborator@example.com
export E2E_COLLABORATOR_PASSWORD='...'
npm run test:e2e
```

### Reading the result

- **"3 skipped" is not a pass.** It means the variables were missing. Playwright exits successfully in that
  case, which is why the suite is not part of CI.
- The suite writes to the project: every run creates two boards owned by the owner account, one invitation and
  membership for the collaborator, a comment and activity entries. Nothing is cleaned up. Use a project and
  accounts you are happy to fill with test data. Board creation is rate-limited in the database to 30 per hour
  per user, which bounds how often the suite can be repeated.
- The test selects elements by their visible text and accessible names. A wording change in the UI can fail it
  without anything being broken.

### What a pass would prove, and what it still would not

A pass shows that login, session cookies, route protection, Server Actions, the database functions over
PostgREST, private Realtime channels (operations, presence, cursors, comments, activity) and PNG export work
together against real Supabase, from wherever the browser runs.

It does not cover registration, email verification, password reset or change, account deletion, share links,
join requests, offline recovery against real Realtime, token expiry on a long-lived connection, or any browser
other than Chromium. The [demo script](demo-script.md) covers the email flows by hand.

## Test areas and where they live

| Area                                                       | Unit / component                                                                                                          | Database                                                                     | Browser                                                | e2e (not yet run) |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| Registration, login, logout, password recovery             | `unit/schemas.test.ts`, `unit/server-actions.test.ts`, `components/auth-forms.test.tsx`                                   | `db/profiles.test.ts` (signup trigger)                                       |                                                        | Login, logout     |
| Email verification                                         | `unit/server-actions.test.ts`, `components/auth-forms.test.tsx`                                                           | `db/profiles.test.ts`, `db/boards.test.ts`                                   |                                                        |                   |
| Route protection and redirects                             | `unit/proxy.test.ts`, `unit/routes.test.ts`                                                                               |                                                                              |                                                        | Test 1, test 2    |
| Profiles and avatars                                       | `unit/avatar-consent-plans.test.ts`, `components/ui.test.tsx`                                                             | `db/profiles.test.ts`                                                        |                                                        |                   |
| Board create, rename, duplicate, trash, restore, purge     | `unit/server-actions.test.ts`, `components/app.test.tsx`                                                                  | `db/boards.test.ts`                                                          | `board.spec.ts` (rename)                               | Test 2            |
| Templates and plan entitlement                             | `unit/template-seed.test.ts`, `unit/avatar-consent-plans.test.ts`, `components/app.test.tsx`                              | `db/boards.test.ts`                                                          |                                                        | Test 2            |
| Roles (owner, editor, viewer) and membership               | `components/board-panels.test.tsx`                                                                                        | `db/boards.test.ts`, `db/canvas.test.ts`                                     | `board.spec.ts` (roles)                                | Test 3 (stranger) |
| Invitations                                                | `components/app.test.tsx`                                                                                                 | `db/invitations.test.ts`                                                     | `accessibility.spec.ts` (invite from the share dialog) | Test 2            |
| Collaboration codes, share links, join requests            | `unit/schemas.test.ts`, `unit/server-actions.test.ts`, `components/app.test.tsx`                                          | `db/sharing.test.ts`                                                         |                                                        | Test 2, test 3    |
| Canvas editing                                             | `unit/board-reducer.test.ts`, `unit/board-utilities.test.ts`                                                              | `db/canvas.test.ts`                                                          | `board.spec.ts` (editing)                              | Test 2            |
| Optimistic updates, offline queue, reconnect, gap recovery | `unit/board-engine.test.ts`, `unit/board-utilities.test.ts`                                                               | `db/canvas.test.ts` (dedup, recovery query)                                  | `board.spec.ts` (offline and recovery)                 |                   |
| Conflict handling                                          | `unit/board-engine.test.ts`                                                                                               | `db/canvas.test.ts`                                                          | `board.spec.ts` (concurrent text edit)                 |                   |
| Undo and redo                                              | `unit/board-engine.test.ts`                                                                                               |                                                                              | `board.spec.ts` (keyboard undo/redo)                   |                   |
| Realtime authorization (who may listen and send)           |                                                                                                                           | `db/realtime.test.ts`                                                        |                                                        |                   |
| Realtime payload validation                                | `unit/board-utilities.test.ts`                                                                                            |                                                                              |                                                        |                   |
| Live edits, presence, cursors between users                | `unit/board-engine.test.ts` (edits)                                                                                       | `db/realtime.test.ts` (server broadcasts)                                    | `board.spec.ts` (collaboration), over SSE              | Test 2            |
| Comments                                                   | `components/board-panels.test.tsx`                                                                                        | `db/comments-activity.test.ts`                                               | `board.spec.ts`                                        | Test 2            |
| Activity feed                                              | `unit/board-utilities.test.ts`, `components/board-panels.test.tsx`                                                        | `db/comments-activity.test.ts`                                               | `board.spec.ts`                                        | Test 2            |
| PNG export                                                 | `unit/board-utilities.test.ts`                                                                                            | `db/comments-activity.test.ts` (recording an export as activity)             | `board.spec.ts` (export)                               | Test 2            |
| Data export, account deletion, cookie consent              | `unit/server-actions.test.ts` (deletion), `unit/avatar-consent-plans.test.ts`, `components/app.test.tsx` (consent banner) | `db/account.test.ts`                                                         |                                                        |                   |
| RLS, grants, function exposure                             |                                                                                                                           | `db/account.test.ts`, `db/boards.test.ts`, `db/profiles.test.ts`             |                                                        |                   |
| Rate limits                                                | `unit/server-actions.test.ts` (pass-through)                                                                              | `db/boards`, `db/canvas`, `db/comments-activity`, `db/sharing`, `db/account` |                                                        |                   |
| Error format and safe messages                             | `unit/errors.test.ts`                                                                                                     |                                                                              | `board.spec.ts` (failure banner)                       | Test 1            |
| Hostile input rendered as text                             | `components/board-panels.test.tsx`                                                                                        | `db/canvas.test.ts` (sanitising), `db/profiles.test.ts`                      | `board.spec.ts`                                        |                   |
| Accessibility                                              | `components/ui.test.tsx`, `components/board-panels.test.tsx`                                                              |                                                                              | `accessibility.spec.ts`                                |                   |

Paths are relative to `tests/`; browser files are in `tests/browser/`.

## Generated template seed

The six starter templates are defined once, in `src/lib/templates/catalog.ts`. The seed migration
`supabase/migrations/20261008000800_seed_templates.sql` is generated from that file and must not be edited by
hand.

```bash
npm run db:generate-templates
```

This runs `tests/unit/template-seed.test.ts` with `UPDATE_TEMPLATE_SEED=1`, which rewrites the migration from
the catalog and then asserts the two match. Without the variable (that is, in `npm run test` and in CI) the same
test only asserts, so a catalog change without a regenerated migration fails the build. The script sets the
variable with POSIX shell syntax; on Windows run it from a POSIX-compatible shell.

If the seed has already been applied to a project, apply the regenerated file again: it upserts on `slug`.

## Continuous integration

`ci.yml` runs the static checks, `npm run test` and `npm run build` in one job and `npm run test:browser` in
another. The e2e suite is not run in CI. Details: [GitHub Actions](github-actions.md).

## Closing the gap

To move the unverified rows in the README's status table to verified:

1. Create a Supabase project and apply the migrations ([Supabase schema](supabase-schema.md)).
2. Run the app against it and walk through the [demo script](demo-script.md), which includes registration,
   email verification and password reset.
3. Run `npm run test:e2e` with the variables above and confirm three tests **pass**, not skip.
4. Repeat step 3 against the deployed URL after [deploying to Render](deployment-render.md).
