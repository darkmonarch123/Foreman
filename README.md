# f o r e m a n

**Plan visually. Build together.**

Foreman is a real-time collaborative visual workspace for brainstorming, project planning, diagrams, notes and
team coordination. People create boards, start from templates, add sticky notes, text, shapes, arrows and
drawings, invite collaborators with roles, comment, follow an activity feed and export boards as PNG.

Formal project title: _Design and Implementation of Foreman: A Real-Time Collaborative Visual Workspace Using
Next.js, Supabase, and WebSocket-Compatible Realtime Communication._

---

## Read this first: what has and has not been verified

This repository was built and tested **without access to a live Supabase project or a Render account**. That
shapes what can honestly be claimed.

| Area                                                                                                                                                          | Status                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Database schema, Row Level Security, every database function, Realtime channel policies                                                                       | **Verified** by automated tests that apply the real migrations to an in-process Postgres (`tests/db`).        |
| Board UI and sync engine: editing, optimistic updates, offline queue, reconnect, conflicts, undo/redo, roles, comments, activity, PNG export, keyboard access | **Verified** in Chromium with several simultaneous users against an in-memory test backend (`tests/browser`). |
| Forms, validation, server actions, route protection, error handling                                                                                           | **Verified** by unit and component tests with Supabase mocked at the client boundary.                         |
| Lint, type-check, production build                                                                                                                            | **Verified**.                                                                                                 |
| Sign-up, email verification, login, password reset through **real Supabase Auth**                                                                             | **Implemented, not run end to end.** Needs a Supabase project.                                                |
| Presence, cursors and live updates over **real Supabase Realtime**                                                                                            | **Implemented, not run end to end.** The authorization policies are tested; the WebSocket transport is not.   |
| Deployment on Render, GitHub Actions workflows                                                                                                                | **Written, not executed.**                                                                                    |

To close the gap, follow [Supabase setup](#supabase-setup), then run the manual
[demo script](docs/demo-script.md) and the real end-to-end suite (`npm run test:e2e`, see
[docs/testing.md](docs/testing.md)). Until that has been done against your project, treat the lower three rows
as unverified.

---

## Features

Everything below is real: persisted in PostgreSQL, authorised by the database, and free of placeholder users,
comments, activity or presence.

- **Accounts.** Registration, login, logout, email verification, password reset and change, through Supabase
  Auth. Sessions live in cookies managed by `@supabase/ssr`; nothing long-lived is kept in `localStorage`.
- **Profiles and avatars.** A profile row is created by a database trigger at sign-up. Avatars are illustrations
  generated locally from a random seed and an initial Male/Female preference. No third-party avatar service is
  used and nothing about the person goes into the avatar URL.
- **Boards.** Create blank or from a template, rename, duplicate, delete to Trash, restore, delete forever.
- **Templates.** Six starter templates: Project Roadmap, Brainstorming Session, User Story Map, Sprint
  Retrospective, System Design Canvas, Study Planner. Gallery with categories, search, pagination, preview and
  plan entitlement checks.
- **Whiteboard.** Pan and zoom canvas with sticky notes, text, rectangles, circles, arrows and freehand
  drawing; select, drag, resize, restyle, in-place text editing, eraser, context menu, command palette,
  keyboard shortcuts.
- **Roles.** Owner, Editor, Viewer, enforced in the database on every read and write.
- **Sharing.** Invitations by email (Editor or Viewer), collaboration codes such as `F-1WE-23XX`, share links,
  join requests with owner approval, four access modes. A code or link never grants more than view access.
- **Real-time collaboration.** Other people's edits, presence and cursors, over private Supabase Realtime
  channels.
- **Offline tolerance.** Edits are applied optimistically, queued durably, and re-sent on reconnect. The server
  deduplicates, so a retried operation is applied once.
- **Conflict handling.** Per-object versions; last accepted write wins for position and style; deletion wins;
  stale text edits are rejected with the current server state.
- **Undo and redo** of your own changes, as new operations. History is never rewritten.
- **Comments.** Board-level or anchored to an object; edit and delete your own.
- **Activity.** Server-generated, newest first, paginated.
- **PNG export** of the whole board or the current view, drawn from board data only.
- **Account.** Data export as JSON, account deletion with password and typed confirmation, sign out
  everywhere.
- **Accessibility.** A Board Outline lists every item with keyboard-operable actions; modals trap and return
  focus; status changes are announced. See [docs/accessibility.md](docs/accessibility.md).

### Not implemented (deliberately)

- **Image upload.** The tool is hidden. The database rejects image objects. See
  [docs/security.md](docs/security.md#image-upload).
- **Invitation emails.** No email provider is integrated. Invitations appear in the invitee's notifications and
  the owner gets a link to pass on. Supabase Auth still sends verification and reset emails.
- **Billing.** Every account is on the Free plan. Plus and Pro are described on the pricing section and cannot
  be purchased.
- CRDT/OT, version-history UI, mobile canvas editing, calls, AI, marketplace.

---

## Technology stack

| Layer     | Choice                                                                         |
| --------- | ------------------------------------------------------------------------------ |
| Framework | Next.js 16 (App Router, React 19, Server Components, Cache Components)         |
| Language  | TypeScript, strict                                                             |
| Styling   | Tailwind CSS v4 with a token system in `src/app/globals.css`                   |
| Forms     | React Hook Form + Zod (the same schemas run in the browser and on the server)  |
| Canvas    | A purpose-built SVG renderer (`src/components/board`) and a 2D-canvas exporter |
| Backend   | Supabase: PostgreSQL, Auth, Row Level Security, Realtime                       |
| Fonts     | Fraunces (display) and Inter (interface), self-hosted from npm packages        |
| Tests     | Vitest, React Testing Library, PGlite (in-process Postgres), Playwright        |
| Hosting   | Render Web Service + managed Supabase project                                  |
| CI/CD     | GitHub Actions                                                                 |

There are no containers, no local database server, no reverse proxy and no microservices.

## Architecture overview

```
Browser ── Server Components / Server Actions (Next.js on Render)
   │                │
   │                └── Supabase (as the signed-in user: anon key + session JWT)
   │
   ├── Supabase REST/RPC  (reads limited by RLS; writes through SECURITY DEFINER functions)
   └── Supabase Realtime  (private channels, authorised by policies on realtime.messages)
```

- The **database is the authority**. Tables grant the browser `SELECT` only, limited by Row Level Security.
  Every write goes through a database function that reads the caller from `auth.uid()` and checks their role.
- The **service-role key is not used** by the application at all.
- The board UI depends on a `BoardServices` interface, not on Supabase. The app supplies a Supabase
  implementation; tests supply an in-memory one.

More in [docs/architecture.md](docs/architecture.md), [docs/supabase-schema.md](docs/supabase-schema.md) and
[docs/realtime.md](docs/realtime.md).

---

## Supabase setup

1. Create a Supabase project.
2. Apply the migrations in `supabase/migrations` in filename order, either with the Supabase CLI
   (`supabase link --project-ref <ref>` then `supabase db push`) or by pasting each file into the SQL editor.
3. **Authentication → Sign In / Providers → Email**: enable email, turn **Confirm email** on, set the minimum
   password length to 10.
4. **Authentication → URL Configuration**: set **Site URL** to your exact origin and add these exact redirect
   URLs (no wildcards):
   - `https://<your-origin>/auth/confirm`
   - `http://localhost:3000/auth/confirm` (for local development)
5. **Authentication → Email Templates** (recommended, so links are verified on your own server):
   - Confirm signup: `{{ .SiteURL }}/verify-email?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

   The default templates also work; `/auth/confirm` accepts the `?code=` style too.

6. **Authentication → Sessions / JWT**: keep the access-token lifetime short (an hour or less). Realtime caches a
   connection's permissions until its token is refreshed.
7. **Authentication → Rate Limits**: review the built-in limits for sign-up, sign-in and email sending.
8. **API settings**: leave the exposed schemas as `public` (and `graphql_public`). Do **not** expose `private`.
9. Configure SMTP if you need more than Supabase's low default email quota.

Full detail, including what each migration does: [docs/supabase-schema.md](docs/supabase-schema.md).

## Local development

Requires Node.js 22.12 or newer.

```bash
npm ci
cp .env.example .env.local      # then fill in your Supabase URL and anon key
npm run dev                     # http://localhost:3000
```

Without Supabase configured the public pages render, account pages show a notice explaining what is missing,
and protected routes redirect to the login page.

## Environment variables

| Variable                        | Where           | Purpose                                  |
| ------------------------------- | --------------- | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | build + runtime | Supabase project URL                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build + runtime | Anon/publishable key (public by design)  |
| `NEXT_PUBLIC_SITE_URL`          | build + runtime | Exact public origin; used in email links |
| `NEXT_PUBLIC_APP_URL`           | build + runtime | Fallback for the above                   |

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so they must be set **before the build**.
Nothing secret may ever use that prefix. `SUPABASE_SERVICE_ROLE_KEY`, `AVATAR_PROVIDER_URL`,
`EMAIL_PROVIDER_API_KEY` and `EMAIL_FROM_ADDRESS` are documented in `.env.example` and are **not used**.

## Deployment on Render

`render.yaml` describes a Node web service: build `npm ci && npm run build`, start `npm run start`, health check
`/api/health`. Step-by-step instructions, including the Supabase URL settings that must match the Render
domain: [docs/deployment-render.md](docs/deployment-render.md).

## GitHub Actions

- `ci.yml` runs on pull requests and pushes to `main`: format check, lint, type-check, unit/component/database
  tests, production build, and the board browser tests.
- `deploy.yml` runs after CI succeeds on `main` and calls the Render deploy hook stored in the
  `RENDER_DEPLOY_HOOK_URL` repository secret.

See [docs/github-actions.md](docs/github-actions.md).

## Test commands

```bash
npm run lint            # ESLint
npm run typecheck       # next typegen + tsc
npm run format:check    # Prettier
npm run test            # unit + component + database tests
npm run test:db         # database tests only (migrations, RLS, functions, realtime policies)
npm run test:browser    # board UI in Chromium against the in-memory test backend
npm run test:e2e        # full journey against a real Supabase project (skipped without E2E_* variables)
npm run check           # format, lint, types, tests and build
```

What each suite proves and does not prove: [docs/testing.md](docs/testing.md).

## Security notes

- Row Level Security on every table; no policy uses `using (true)`.
- No direct table writes from the browser. All writes are database functions with pinned `search_path`.
- Identity, role and board access are always derived on the server from the session; nothing of the kind is
  accepted from the client.
- Secrets live in environment variables. The service-role key is not used.
- Login, password-reset, verification-resend and collaboration-code responses do not reveal whether an account
  or a private board exists.
- Invitation and share-link tokens are stored only as SHA-256 hashes.
- Rate limits in the database for board creation, canvas operations, comments, invitations, code lookups,
  exports and account actions.
- Security headers including a Content-Security-Policy that allows no third-party origins.
- User text is always rendered as text. Colours and other style values are whitelisted in the database.

Detail, trade-offs and what has not been independently tested: [docs/security.md](docs/security.md).

## Realtime event summary

| Topic                   | Direction          | Carries                                 |
| ----------------------- | ------------------ | --------------------------------------- |
| `board:{id}:operations` | database → clients | accepted canvas operations, in sequence |
| `board:{id}:comments`   | database → clients | comment created / updated / deleted     |
| `board:{id}:activity`   | database → clients | activity notifications                  |
| `board:{id}:presence`   | clients ↔ clients  | who is connected                        |
| `board:{id}:cursors`    | clients ↔ clients  | cursor positions (never stored)         |

All five are private channels. Members may listen on all of them; clients may send only on `presence` and
`cursors`. See [docs/realtime.md](docs/realtime.md).

## Known limitations

- **Not yet run against live Supabase or Render** (see the table at the top).
- Presence and cursor identity are asserted by the client. Only board members can join the channel and only
  members are ever displayed, but one member could show another member as online. Canvas operations, comments
  and activity cannot be forged this way.
- A removed member can keep _listening_ on Realtime until their token refreshes. Writes and page loads are
  refused immediately.
- The Content-Security-Policy keeps `'unsafe-inline'` for scripts (see docs/security.md).
- One object can be selected at a time; no rotation handle; freehand drawings can be moved but not resized.
- The canvas is built for desktop. On small screens it is usable for viewing; editing is not optimised.
- Undo history lasts for the current page session.
- Text in exported PNGs is laid out by a separate routine and can wrap slightly differently from the screen.
- Screen-reader access to the canvas is through the Board Outline, not the drawing surface itself.
- Individual sessions cannot be listed; only "sign out everywhere" is offered.
- Final removal of a deleted account's auth record is a manual operator step.
- Notification preferences are stored, but no emails are sent for them.

## Future work

Secure image upload; invitation email delivery; multi-select and grouping; rotation; a version-history
interface on top of the operation log; CRDT-based text editing; mobile canvas editing; billing; a stricter,
nonce-based CSP; server-verified presence.

## Documentation

- [Architecture](docs/architecture.md)
- [Supabase schema and policies](docs/supabase-schema.md)
- [Realtime](docs/realtime.md)
- [Security](docs/security.md)
- [Accessibility](docs/accessibility.md)
- [Testing](docs/testing.md)
- [Deployment on Render](docs/deployment-render.md)
- [GitHub Actions](docs/github-actions.md)
- [Demo script](docs/demo-script.md)
