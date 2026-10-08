# Supabase schema and policies

This document describes the database exactly as the SQL in `supabase/migrations` defines it: tables, constraints,
Row Level Security, every callable function, and the rules those functions enforce.

Related: [Architecture](architecture.md), [Realtime](realtime.md), [Security](security.md), [Testing](testing.md).

## Verification status

- **Verified:** every migration is applied, in filename order, to an in-process Postgres (PGlite) by
  `tests/db/harness.ts`, and the suites in `tests/db` exercise the tables, policies, grants and functions as the
  `anon` and `authenticated` roles. Run them with `npm run test:db`.
- **Not verified:** the migrations have **not** been applied to a real Supabase project. The test database uses a
  small stand-in for Supabase's `auth` and `realtime` schemas (`tests/db/supabase-shim.sql`). See
  [Differences between the test database and real Supabase](#differences-between-the-test-database-and-real-supabase)
  and [Supabase settings the schema depends on](#supabase-settings-the-schema-depends-on).

## Applying the migrations

With the Supabase CLI, from the repository root:

```bash
supabase link --project-ref <ref>
supabase db push
```

Or paste each file into the SQL editor, **in filename order**. Later files call functions and alter tables created
by earlier ones.

The repository contains `supabase/migrations` only; there is no `supabase/config.toml`. If your CLI version asks
for one, run `supabase init` first. It does not touch the migrations.

| File                                          | What it does                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261008000100_schema.sql`                   | Creates the `private` schema, all tables, check constraints, foreign keys and indexes, and the two rows in `private.settings`.                                                                                                            |
| `20261008000200_helpers_and_profiles.sql`     | Private helpers (identity, role checks, tokens, collaboration codes, rate limiting, activity log, broadcast), the triggers on `auth.users`, the `updated_at` trigger on `profiles`, the profile functions, and the Realtime topic parser. |
| `20261008000300_boards_and_membership.sql`    | Board create/read/update/trash/purge/duplicate, sharing settings, collaboration codes, share links, `join_board`, members, invitations, join requests, notifications.                                                                     |
| `20261008000400_canvas_comments_activity.sql` | Property sanitising, `submit_operation`, `load_board_state`, `get_operations_after`, comments, the activity feed, export logging.                                                                                                         |
| `20261008000500_account.sql`                  | `export_my_data` and `request_account_deletion`.                                                                                                                                                                                          |
| `20261008000600_rls_and_grants.sql`           | Enables RLS on every table, revokes all table and function privileges from the API roles, then grants `SELECT` on specific tables, creates the `SELECT` policies and grants `EXECUTE` on the callable functions.                          |
| `20261008000700_realtime.sql`                 | Two policies on `realtime.messages` that authorise private board channels. See [Realtime](realtime.md).                                                                                                                                   |
| `20261008000800_seed_templates.sql`           | Upserts the six starter templates. Generated; see [Template seed](#template-seed).                                                                                                                                                        |

Migration 0300 calls `private.sanitize_props`, which is created in 0400. That is fine because PL/pgSQL resolves
function references when the function runs, not when it is created, but it means 0300 is not usable on its own.

The schema needs no extensions: UUIDs come from `gen_random_uuid()` and hashing from the built-in `sha256()`.

## Schemas

| Schema     | Contents                                                                                       | Exposed through the Data API?                 |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `public`   | All application tables and the functions the application calls.                                | Yes.                                          |
| `private`  | Helper functions, `private.rate_limits`, `private.settings`.                                   | **No. Do not add it to the exposed schemas.** |
| `auth`     | Supabase's. The migrations add two triggers on `auth.users` and read `auth.uid()`.             | Managed by Supabase.                          |
| `realtime` | Supabase's. The migrations add two policies on `realtime.messages` and call `realtime.send()`. | Managed by Supabase.                          |

Why `private` exists: helper functions and bookkeeping that the browser must never call or read directly live
there. The `authenticated` role is granted `USAGE` on `private` and `EXECUTE` on exactly four helpers
(`is_board_member`, `is_board_owner`, `own_verified_email`, `board_id_from_topic`), because RLS policies are
evaluated as the calling role and need to call them. Nothing else in `private` is executable or readable by `anon`
or `authenticated`. If `private` were added to the exposed schemas, those four helpers would become callable as
RPCs; the tables in it would still be unreadable.

## Tables

Conventions: every primary key is a UUID; enumerations are `text` columns with check constraints (there are no
Postgres enum types); every table has RLS enabled.

### Summary

| Table                 | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `profiles`            | One row per `auth.users` row, created by trigger at sign-up.              |
| `templates`           | Starter template catalog (seeded).                                        |
| `boards`              | A board, its owner, access mode and current operation sequence.           |
| `board_sharing`       | Collaboration code and share-link hash, kept apart from `boards`.         |
| `board_members`       | Who is on a board and with which role.                                    |
| `board_invitations`   | Email invitations.                                                        |
| `board_join_requests` | Requests to join made with a code or link on a request-access board.      |
| `canvas_objects`      | Current state of each object on a board.                                  |
| `board_operations`    | Append-only log of accepted canvas operations.                            |
| `board_snapshots`     | Periodic full copies of a board's live objects.                           |
| `board_comments`      | Comments, optionally anchored to an object.                               |
| `board_activity`      | Activity feed entries, written only by database functions.                |
| `security_events`     | Security log. Not readable through the API.                               |
| `cookie_consents`     | Append-only record of consent choices.                                    |
| `uploaded_files`      | Metadata contract for image uploads. **Unused: nothing inserts into it.** |
| `private.rate_limits` | One counter per user and action.                                          |
| `private.settings`    | `snapshot_interval` (50) and `invitation_ttl_days` (7).                   |

### `profiles`

| Column                                                    | Notes                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                                                      | PK; FK to `auth.users(id)` `on delete cascade`.                                                |
| `first_name`, `last_name`                                 | 1 to 60 characters.                                                                            |
| `username`                                                | Matches `^[a-z0-9_]{3,24}$`; unique index `profiles_username_key`.                             |
| `email`, `email_verified`                                 | Mirrored from `auth.users` by trigger. Index on `lower(email)`.                                |
| `avatar_url`                                              | Must match `^/api/avatar/(male\|female)/[a-z0-9]{8,32}$`, so it can never point off-site.      |
| `avatar_seed`                                             | `^[a-z0-9]{8,32}$`. Generated in the database (16 hex characters).                             |
| `avatar_style`                                            | Only `portrait`.                                                                               |
| `avatar_gender_selection`                                 | `MALE` or `FEMALE`. An avatar-generation preference, not an identity attribute.                |
| `plan`                                                    | `FREE`, `PLUS`, `PRO`; default `FREE`. No function changes it.                                 |
| `status`                                                  | `ACTIVE`, `PENDING_DELETION`, `DELETED`; default `ACTIVE`. No function sets `DELETED`.         |
| `notification_prefs`                                      | JSON object.                                                                                   |
| `created_at`, `updated_at`, `last_login_at`, `deleted_at` | `updated_at` is maintained by a trigger; `last_login_at` mirrors `auth.users.last_sign_in_at`. |

### `templates`

`slug` (unique, `^[a-z0-9-]{3,60}$`), `name` (1 to 80), `description`, `category` (`PLANNING`, `BRAINSTORMING`,
`STUDY`, `PRODUCT`, `ENGINEERING`), `min_plan` (`FREE`, `PLUS`, `PRO`), `is_featured`, `is_published`,
`sort_order`, `content` (JSON array of objects to copy onto a new board). Index on `(category, sort_order)`.

### `boards`

| Column                | Notes                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `owner_id`            | FK to `profiles(id)` **`on delete restrict`**: a profile that owns any board cannot be deleted. |
| `title`               | Contains a non-whitespace character, at most 120 characters.                                    |
| `description`         | At most 500 characters, default `''`.                                                           |
| `access_mode`         | `PRIVATE` (default), `INVITE_ONLY`, `LINK_VIEWER`, `LINK_REQUEST_ACCESS`.                       |
| `viewers_can_comment` | Default `false`.                                                                                |
| `template_id`         | FK to `templates(id)` `on delete set null`.                                                     |
| `last_sequence`       | Sequence number of the last accepted operation; `>= 0`.                                         |
| `deleted_at`          | Set when the board is in the owner's Trash.                                                     |

Indexes: `(owner_id)`, `(updated_at desc)`. `updated_at` is set explicitly by the functions that change a board;
there is no trigger on this table.

### `board_sharing`

One row per board (`board_id` is the PK and an FK `on delete cascade`). It is separate from `boards` so that members,
who can read the board row, cannot read the code or link.

| Column               | Notes                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| `collaboration_code` | Matches `^F-[A-Z0-9]{3}-[A-Z0-9]{4}$`; unique index `board_sharing_code_key`. |
| `code_enabled`       | Default `true`.                                                               |
| `share_link_enabled` | Default `false`.                                                              |
| `share_token_hash`   | SHA-256 (hex) of the share-link token, or null. Unique where not null.        |

### `board_members`

`board_id` (FK cascade), `user_id` (FK to `profiles` cascade), `role` (`OWNER`, `EDITOR`, `VIEWER`), `created_at`.

- Unique `(board_id, user_id)`.
- Partial unique index `board_members_single_owner` on `(board_id) where role = 'OWNER'`: at most one owner per
  board, enforced by the schema.
- Indexes on `(board_id)` and `(user_id)`.

`boards.owner_id` and the `OWNER` row are kept in step by the functions (`create_board`, `duplicate_board`,
`transfer_ownership`); no constraint ties them together.

### `board_invitations`

| Column                        | Notes                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `board_id`                    | FK cascade.                                                                             |
| `inviter_id`                  | FK to `profiles` cascade.                                                               |
| `invitee_email`               | Must already be lower-case; 3 to 254 characters.                                        |
| `role`                        | `EDITOR` or `VIEWER`. An invitation can never grant `OWNER`.                            |
| `token_hash`                  | SHA-256 (hex) of the invitation token; unique. Not selectable by API roles.             |
| `status`                      | `PENDING` (default), `ACCEPTED`, `DECLINED`, `EXPIRED`, `REVOKED`.                      |
| `expires_at`                  | Required.                                                                               |
| `responded_at`, `accepted_by` | `accepted_by` is an FK to `profiles` `on delete set null`; not selectable by API roles. |

Indexes: `(board_id, created_at desc)`; `(invitee_email) where status = 'PENDING'`; unique
`(board_id, invitee_email) where status = 'PENDING'` (one pending invitation per address per board).

### `board_join_requests`

`board_id` (FK cascade), `user_id` (FK cascade), `status` (`PENDING`, `APPROVED`, `REJECTED`), `created_at`,
`decided_at`, `decided_by` (FK `on delete set null`). Index `(board_id, created_at desc)`; unique
`(board_id, user_id) where status = 'PENDING'`.

### `canvas_objects`

| Column                     | Notes                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                       | PK, **no default**: the client chooses the object id.                                                  |
| `board_id`                 | FK cascade.                                                                                            |
| `type`                     | `STICKY_NOTE`, `TEXT`, `RECTANGLE`, `CIRCLE`, `ARROW`, `DRAWING`, `IMAGE`.                             |
| `x`, `y`                   | Between -1,000,000 and 1,000,000.                                                                      |
| `width`, `height`          | Between -100,000 and 100,000 (negative values are meaningful for arrows).                              |
| `rotation`                 | Between -360 and 360, default 0.                                                                       |
| `z_index`                  | `bigint`, default 0.                                                                                   |
| `props`                    | JSON object; only whitelisted keys are ever written (see [Property sanitising](#property-sanitising)). |
| `version`                  | Starts at 1, incremented by every accepted operation on the object.                                    |
| `created_by`, `updated_by` | FKs to `profiles` `on delete set null`.                                                                |
| `deleted_at`               | Soft delete. Deleted objects stay in the table and can be restored.                                    |

Index: `(board_id) where deleted_at is null`. The check constraint allows `IMAGE`, but no function will create one.

### `board_operations`

| Column                                 | Notes                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `board_id`                             | FK cascade.                                                                                     |
| `operation_id`                         | Chosen by the client. Unique per board: `(board_id, operation_id)`.                             |
| `actor_id`                             | FK `on delete set null`. Always `auth.uid()` of the submitter.                                  |
| `operation_type`                       | `OBJECT_CREATED`, `OBJECT_UPDATED`, `OBJECT_MOVED`, `OBJECT_DELETED`, `OBJECT_RESTORED`.        |
| `object_id`                            | Not a foreign key.                                                                              |
| `payload`                              | The payload **as the client sent it** (up to 64 KiB). It is not sanitised; see the note below.  |
| `object_state`                         | The full object after the operation, as produced by `private.object_state`.                     |
| `expected_object_version`              | What the client sent, or null.                                                                  |
| `resulting_version`                    | The object's version after the operation.                                                       |
| `client_timestamp`, `server_timestamp` | `server_timestamp` defaults to `clock_timestamp()`.                                             |
| `board_sequence_number`                | `>= 1`. Unique per board: `(board_id, board_sequence_number)`; this is also the recovery index. |

Rows are never updated or deleted by any function (they go only when the board is purged).

Note on `payload`: `canvas_objects.props` only ever contains sanitised properties, but the raw request payload is
stored here unchanged and `authenticated` members of the board have `SELECT` on this table. The application does
not read the column (it uses `object_state` through the functions), and only owners and editors can cause a row to
be written.

### `board_snapshots`

`board_id` (FK cascade), `sequence_number` (`>= 0`), `state` (JSON object `{"objects": [...]}` holding the
non-deleted objects in `z_index`, `created_at` order), `created_at`. Unique `(board_id, sequence_number)`.

### `board_comments`

`board_id` (FK cascade), `author_id` (FK `set null`), `object_id` (FK to `canvas_objects` `set null`), `body`
(contains a non-whitespace character, at most 2000 characters), `created_at`, `edited_at`, `deleted_at`. Index
`(board_id, created_at desc)`.

### `board_activity`

`board_id` (FK cascade), `actor_id` (FK `set null`), `type` (see [Value sets](#value-sets)), `object_id` (not an
FK), `metadata` (JSON object), `created_at` (default `clock_timestamp()`). Index `(board_id, created_at desc)`.

### `security_events`

`user_id` (FK `set null`), `event_type` (1 to 60 characters), `metadata`, `created_at`. Index
`(user_id, created_at desc)`. Event types written today: `JOIN_RATE_LIMITED`, `JOIN_LOOKUP_FAILED`, `BOARD_PURGED`,
`MEMBER_ROLE_CHANGED`, `OWNERSHIP_TRANSFERRED`, `DATA_EXPORTED`, `ACCOUNT_DELETION_REQUESTED`.

### `cookie_consents`

`user_id` (FK cascade), `consent_version` (1 to 20 characters), `analytics`, `preferences`, `created_at`. Index
`(user_id, created_at desc)`. Each call to `record_cookie_consent` adds a row.

### `uploaded_files`

`board_id` (FK cascade), `uploader_id` (FK `set null`), `mime_type` (`image/png`, `image/jpeg`, `image/webp`),
`size_bytes` (1 to 5,242,880), `width` and `height` (1 to 4096), `storage_key` (unique UUID). Index `(board_id)`.
There is no function, policy or grant that allows a row to be written. Image upload is not implemented.

### `private.rate_limits` and `private.settings`

`rate_limits`: PK `(user_id, action)`, `window_start`, `hits`. `settings`: `key` PK, `value` JSON. Both have RLS
enabled with no policies and no grants; only `SECURITY DEFINER` functions touch them.

## Value sets

| Set                 | Values                                                                                                           | Where                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Board role          | `OWNER`, `EDITOR`, `VIEWER`                                                                                      | `board_members.role`                              |
| Invitable role      | `EDITOR`, `VIEWER`                                                                                               | `board_invitations.role`, role-changing functions |
| Access mode         | `PRIVATE`, `INVITE_ONLY`, `LINK_VIEWER`, `LINK_REQUEST_ACCESS`                                                   | `boards.access_mode`                              |
| Invitation status   | `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `REVOKED`                                                          | `board_invitations.status`                        |
| Join request status | `PENDING`, `APPROVED`, `REJECTED`                                                                                | `board_join_requests.status`                      |
| Operation type      | `OBJECT_CREATED`, `OBJECT_UPDATED`, `OBJECT_MOVED`, `OBJECT_DELETED`, `OBJECT_RESTORED`                          | `board_operations.operation_type`                 |
| Object type         | `STICKY_NOTE`, `TEXT`, `RECTANGLE`, `CIRCLE`, `ARROW`, `DRAWING`, `IMAGE` (`IMAGE` is refused by every function) | `canvas_objects.type`                             |
| Profile status      | `ACTIVE`, `PENDING_DELETION`, `DELETED`                                                                          | `profiles.status`                                 |
| Plan                | `FREE`, `PLUS`, `PRO`                                                                                            | `profiles.plan`, `templates.min_plan`             |
| Template category   | `PLANNING`, `BRAINSTORMING`, `STUDY`, `PRODUCT`, `ENGINEERING`                                                   | `templates.category`                              |

Activity types (`board_activity.type`), all of which are written by some function:

- Board: `BOARD_CREATED`, `BOARD_RENAMED`, `BOARD_DELETED`, `BOARD_RESTORED`, `BOARD_DUPLICATED`,
  `TEMPLATE_APPLIED`, `BOARD_EXPORTED`
- Membership: `MEMBER_INVITED`, `INVITATION_ACCEPTED`, `INVITATION_DECLINED`, `INVITATION_REVOKED`,
  `MEMBER_JOINED`, `MEMBER_REMOVED`, `MEMBER_LEFT`, `MEMBER_ROLE_CHANGED`, `OWNERSHIP_TRANSFERRED`,
  `JOIN_REQUEST_CREATED`, `JOIN_REQUEST_APPROVED`, `JOIN_REQUEST_REJECTED`
- Sharing: `SHARING_UPDATED`, `SHARE_LINK_ENABLED`, `SHARE_LINK_DISABLED`, `SHARE_LINK_REGENERATED`,
  `COLLABORATION_CODE_REGENERATED`
- Canvas: `OBJECT_CREATED`, `OBJECT_UPDATED`, `OBJECT_MOVED`, `OBJECT_DELETED`, `OBJECT_RESTORED`
- Comments: `COMMENT_CREATED`, `COMMENT_UPDATED`, `COMMENT_DELETED`

Invitation expiry is evaluated lazily: a row whose stored status is `PENDING` and whose `expires_at` has passed is
reported and treated as `EXPIRED` (`private.effective_invitation_status`). The stored value is only rewritten when
`create_invitation` next runs for that board.

## Row Level Security and privileges

Migration 0600 does the following, in this order:

1. Enables RLS on all 15 `public` tables and both `private` tables.
2. Revokes **all** privileges on all tables in `public` from `anon` and `authenticated`, and on all tables in
   `private` from `public`, `anon` and `authenticated`.
3. Revokes `EXECUTE` on **all** functions in `public` and `private` from `public`, `anon` and `authenticated`.
4. Grants back `SELECT` on specific tables, creates one `SELECT` policy per readable table, and grants `EXECUTE`
   on the callable functions one by one.

The result, which `tests/db/account.test.ts` ("function exposure") and `tests/db/boards.test.ts` assert:

- `anon` and `authenticated` have **no** `INSERT`, `UPDATE` or `DELETE` privilege on any application table, and
  there are no write policies. Every write goes through a function.
- Every `SECURITY DEFINER` function has `search_path` pinned to the empty string and refers to every object by
  its schema-qualified name. Functions that are not `SECURITY DEFINER` pin it too.
- Functions read the caller from `auth.uid()`. No function takes the acting user's id as an argument.
- No policy is `using (true)`.

| Table                 | `anon`   | `authenticated`                  | Rows visible under the `SELECT` policy                                                          |
| --------------------- | -------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `profiles`            | none     | `SELECT`                         | Own row only (`id = auth.uid()`). Other people's names reach the client only through functions. |
| `templates`           | `SELECT` | `SELECT`                         | `is_published`.                                                                                 |
| `boards`              | none     | `SELECT`                         | Not in Trash and caller is a member, **or** caller is `owner_id` (so owners see their Trash).   |
| `board_sharing`       | none     | `SELECT`                         | Caller is the board's `owner_id`.                                                               |
| `board_members`       | none     | `SELECT`                         | Caller is a member of the board and the board is not in Trash.                                  |
| `board_invitations`   | none     | `SELECT` on nine columns (below) | Caller owns the board, or `invitee_email` equals the caller's own verified email.               |
| `board_join_requests` | none     | `SELECT`                         | Caller owns the board, or made the request.                                                     |
| `canvas_objects`      | none     | `SELECT`                         | Member of a board that is not in Trash (soft-deleted objects included).                         |
| `board_operations`    | none     | `SELECT`                         | Member of a board that is not in Trash.                                                         |
| `board_snapshots`     | none     | `SELECT`                         | Member of a board that is not in Trash.                                                         |
| `board_comments`      | none     | `SELECT`                         | `deleted_at is null` and member of a board that is not in Trash.                                |
| `board_activity`      | none     | `SELECT`                         | Member of a board that is not in Trash.                                                         |
| `cookie_consents`     | none     | `SELECT`                         | Own rows.                                                                                       |
| `uploaded_files`      | none     | `SELECT`                         | Member of a board that is not in Trash.                                                         |
| `security_events`     | none     | none                             | No grant and no policy: unreadable through the API.                                             |
| `private.*`           | none     | none                             | No grant and no policy.                                                                         |

`board_invitations` uses a column-level grant: `id, board_id, inviter_id, invitee_email, role, status, expires_at,
created_at, responded_at`. `token_hash` and `accepted_by` are not granted, so `select *` on this table fails with
"permission denied"; a client must name columns.

In practice the application selects directly from only two tables, `profiles` (own row) and `templates`.
Everything else is read through the functions below, which apply the same membership rules.

Things the migration does not change:

- `service_role` keeps whatever Supabase's defaults give it and bypasses RLS. The application does not use the
  service-role key.
- The revokes apply to objects that exist when the migration runs. Supabase's default privileges grant new tables
  and functions in `public` to the API roles, so any later migration that adds one must revoke and grant
  explicitly in the same way.

## Functions

All functions raise errors with SQLSTATE `P0001` and a stable code as the message (for example `BOARD_NOT_FOUND`).
`src/lib/errors.ts` maps codes to messages.

Shorthand used below:

- **Signed in**: `auth.uid()` is not null, otherwise `UNAUTHENTICATED`.
- **Verified**: signed in, and the caller's profile has `status = 'ACTIVE'` (otherwise `ACCOUNT_INACTIVE`) and
  `email_verified` (otherwise `EMAIL_NOT_VERIFIED`).
- **Role check**: `private.require_board_role(board, roles)`. If the caller is not a member, or the board is in
  Trash, it raises `BOARD_NOT_FOUND`: the same error as for a board that does not exist. If the caller is a
  member without one of the required roles it raises `BOARD_ACCESS_DENIED`.

Read functions need the caller to be signed in; write functions need the caller to be verified. The exceptions
are noted. `RATE_LIMITED` is listed under [Rate limits](#rate-limits) rather than repeated in each row.

`EXECUTE` is granted to `authenticated` for every function below. `username_available` is the only one also
granted to `anon`.

### Profiles and account

| Function                                                       | Caller                  | Behaviour                                                                                                                                                                                                                                                            | Errors                                                    |
| -------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `username_available(p_username)`                               | `anon`, `authenticated` | True when the trimmed, lower-cased value matches `^[a-z0-9_]{3,24}$` and no profile has it. Not rate-limited in the database.                                                                                                                                        | none                                                      |
| `update_profile(p_first_name, p_last_name, p_username)`        | Signed in               | Trims, validates, updates the caller's row if it is `ACTIVE`. Returns the profile as JSON.                                                                                                                                                                           | `VALIDATION_FAILED`, `USERNAME_TAKEN`, `ACCOUNT_INACTIVE` |
| `regenerate_avatar(p_gender default null)`                     | Signed in               | New random seed; optionally switches `MALE`/`FEMALE`. Rebuilds `avatar_url` as `/api/avatar/<gender>/<seed>`. Returns the profile.                                                                                                                                   | `VALIDATION_FAILED`, `ACCOUNT_INACTIVE`                   |
| `update_notification_prefs(p_prefs)`                           | Signed in               | Keeps only boolean values for the keys `invitations`, `join_requests`, `comments`, `product_updates` and merges them into the stored object. Returns the merged object. Does not check profile status.                                                               | `VALIDATION_FAILED` (not a JSON object)                   |
| `record_cookie_consent(p_version, p_analytics, p_preferences)` | Signed in               | Inserts a consent row. Version must be 1 to 20 characters.                                                                                                                                                                                                           | `VALIDATION_FAILED`                                       |
| `export_my_data()`                                             | Signed in               | Returns one JSON document (`format: "foreman-export-v1"`): profile; boards the caller is on (not in Trash, or owned) with their live objects; the caller's own non-deleted comments; the latest 2000 activity rows on boards the caller is on. Logs `DATA_EXPORTED`. | none                                                      |
| `request_account_deletion(p_confirmation)`                     | Signed in               | See [Account deletion](#account-deletion).                                                                                                                                                                                                                           | `CONFIRMATION_MISMATCH`, `OWNED_BOARDS_REQUIRE_TRANSFER`  |

### Boards

| Function                                                                                                         | Caller                      | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                      | Errors                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `create_board(p_title, p_description default '', p_access_mode default 'PRIVATE', p_template_slug default null)` | Verified                    | Trims and validates. With a template: it must be published and the caller's plan must rank at least `min_plan`. Inserts the board, the `OWNER` membership and the sharing row (new code); copies template objects (the six creatable types, properties sanitised, `z_index` = position in the template); writes snapshot 0; logs `BOARD_CREATED` and, with a template, `TEMPLATE_APPLIED`. Returns `{id, collaboration_code}`. | `VALIDATION_FAILED`, `TEMPLATE_NOT_FOUND`, `PLAN_REQUIRED`, `CODE_GENERATION_FAILED` |
| `get_board(p_board_id)`                                                                                          | Signed in; any role         | Returns `id, title, description, access_mode, viewers_can_comment, owner_id, last_sequence, created_at, updated_at, role`.                                                                                                                                                                                                                                                                                                     | `BOARD_NOT_FOUND`                                                                    |
| `list_boards(p_scope default 'all', p_search, p_limit default 60, p_offset default 0)`                           | Signed in                   | Scope `all`, `mine`, `shared` or `trash` (Trash lists only boards the caller owns). Optional case-insensitive title substring. Limit clamped to 1..100. Newest `updated_at` first. Each item has the caller's `role`, `member_count`, up to five members (owner first; id, names, avatar) and a `preview` of up to 80 non-drawing objects.                                                                                     | `VALIDATION_FAILED` (unknown scope)                                                  |
| `update_board(p_board_id, p_title, p_description default null)`                                                  | Verified; `OWNER`           | Sets the title (1 to 120 after trimming) and description (at most 500). Logs `BOARD_RENAMED` if the title changed. Returns `get_board`. See the known issue below.                                                                                                                                                                                                                                                             | `VALIDATION_FAILED`, role-check errors                                               |
| `delete_board(p_board_id)`                                                                                       | Verified; `OWNER`           | Logs `BOARD_DELETED`, then sets `deleted_at` (moves the board to the owner's Trash; it disappears for everyone else).                                                                                                                                                                                                                                                                                                          | role-check errors                                                                    |
| `restore_board(p_board_id)`                                                                                      | Verified; `owner_id`        | Only for a board that is in Trash and owned by the caller. Logs `BOARD_RESTORED`.                                                                                                                                                                                                                                                                                                                                              | `BOARD_NOT_FOUND`                                                                    |
| `purge_board(p_board_id)`                                                                                        | Verified; `owner_id`        | Hard-deletes a board that is in Trash (cascades to everything on it). Logs the security event `BOARD_PURGED`. A board that is not in Trash cannot be purged.                                                                                                                                                                                                                                                                   | `BOARD_NOT_FOUND`                                                                    |
| `duplicate_board(p_board_id, p_title default null)`                                                              | Verified; `OWNER`, `EDITOR` | Creates a new `PRIVATE` board owned by the caller with the same description and `template_id`, and copies the live, non-image objects with new ids. Members, comments, activity and sharing settings are not copied. Default title is the first 112 characters of the source title plus `(copy)`. Logs `BOARD_CREATED` on the copy and `BOARD_DUPLICATED` on the source. Returns `{id, collaboration_code}`.                   | `VALIDATION_FAILED`, `CODE_GENERATION_FAILED`, role-check errors                     |

Known issue in `update_board`: the signature suggests that a null `p_description` leaves the description
unchanged, but `private.trim_ws(null)` returns an empty string, so the `coalesce` never falls back and a null
`p_description` **clears** the description. The board top bar's rename (`renameBoard` in
`src/lib/board/supabase-services.ts`) passes null.

### Sharing, codes and join requests

| Function                                                                                                 | Caller             | Behaviour                                                                                                                                                                                                                                                                                                                                                                      | Errors                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `get_sharing(p_board_id)`                                                                                | Signed in; `OWNER` | Returns `board_id, access_mode, viewers_can_comment, collaboration_code, code_enabled, share_link_enabled, share_link_generated`.                                                                                                                                                                                                                                              | role-check errors                                                    |
| `update_sharing(p_board_id, p_access_mode, p_code_enabled, p_share_link_enabled, p_viewers_can_comment)` | Verified; `OWNER`  | Null arguments mean "leave unchanged". Switching to `PRIVATE` is refused while anyone else is a member; when allowed it revokes pending invitations and rejects pending join requests. The share link cannot be enabled before one has been generated. Logs `SHARE_LINK_ENABLED`/`SHARE_LINK_DISABLED` and `SHARING_UPDATED` for what actually changed. Returns `get_sharing`. | `VALIDATION_FAILED`, `BOARD_HAS_MEMBERS`, `SHARE_LINK_NOT_GENERATED` |
| `regenerate_collaboration_code(p_board_id)`                                                              | Verified; `OWNER`  | Replaces the code (the old one stops working at once). Logs `COLLABORATION_CODE_REGENERATED`. Returns the new code.                                                                                                                                                                                                                                                            | `CODE_GENERATION_FAILED`                                             |
| `regenerate_share_link(p_board_id)`                                                                      | Verified; `OWNER`  | Generates a new token, stores its hash, enables the link. Returns the raw token; this is the only time it is available.                                                                                                                                                                                                                                                        | role-check errors                                                    |
| `join_board(p_code default null, p_token default null)`                                                  | Verified           | Resolves a code or link. Returns a status instead of raising; see [Collaboration codes](#collaboration-codes).                                                                                                                                                                                                                                                                 | only the caller checks                                               |
| `normalize_collaboration_code(p_code)`                                                                   | `authenticated`    | Pure helper: removes all whitespace and upper-cases.                                                                                                                                                                                                                                                                                                                           | none                                                                 |
| `list_join_requests(p_board_id)`                                                                         | Signed in; `OWNER` | Pending requests with the requester's `user_id, first_name, last_name, username, avatar_url`.                                                                                                                                                                                                                                                                                  | role-check errors                                                    |
| `decide_join_request(p_request_id, p_approve, p_role default 'VIEWER')`                                  | Verified; `OWNER`  | The request must be pending and on a board the caller owns. Approve: adds the requester with `EDITOR` or `VIEWER` (no change if already a member) and logs `JOIN_REQUEST_APPROVED`. Reject: logs `JOIN_REQUEST_REJECTED`.                                                                                                                                                      | `JOIN_REQUEST_NOT_FOUND`, `INVALID_ROLE`, role-check errors          |
| `get_notifications()`                                                                                    | Signed in          | `{invitations, join_requests}`: the result of `list_my_invitations()` plus pending join requests on boards the caller owns.                                                                                                                                                                                                                                                    | none                                                                 |

### Membership

| Function                                            | Caller              | Behaviour                                                                                                                                                                                                                         | Errors                                                                              |
| --------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `get_board_members(p_board_id)`                     | Signed in; any role | `user_id, role, first_name, last_name, username, avatar_url, joined_at`, owner first. Never returns email addresses.                                                                                                              | role-check errors                                                                   |
| `change_member_role(p_board_id, p_user_id, p_role)` | Verified; `OWNER`   | Sets `EDITOR` or `VIEWER` on another member. No-op if unchanged. Logs activity and a security event.                                                                                                                              | `INVALID_ROLE`, `CANNOT_CHANGE_OWN_ROLE`, `MEMBER_NOT_FOUND`, `CANNOT_CHANGE_OWNER` |
| `remove_member(p_board_id, p_user_id)`              | Verified; any role  | The owner may remove anyone but themselves; anyone else may remove only themselves (leave). Logs `MEMBER_REMOVED` or `MEMBER_LEFT` before deleting the row.                                                                       | `BOARD_ACCESS_DENIED`, `MEMBER_NOT_FOUND`, `OWNER_CANNOT_LEAVE`                     |
| `transfer_ownership(p_board_id, p_new_owner_id)`    | Verified; `OWNER`   | The target must already be a member with an active, verified profile. The caller becomes `EDITOR`, the target `OWNER`, and `boards.owner_id` is updated. No-op when the target is the caller. Logs activity and a security event. | `MEMBER_NOT_FOUND`                                                                  |

### Invitations

| Function                                                                | Caller             | Behaviour                                                                                                                                                                                                                                                                                                                                                                                | Errors                                                                                              |
| ----------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `create_invitation(p_board_id, p_email, p_role)`                        | Verified; `OWNER`  | Lower-cases and validates the address. If a pending invitation for that address exists on the board it is renewed (new token, role, expiry, inviter); otherwise a row is inserted and `MEMBER_INVITED` is logged. A `PRIVATE` board becomes `INVITE_ONLY`. Returns `{id, token, expires_at}`. The response is the same whether or not an account exists for the address.                 | `INVALID_ROLE`, `VALIDATION_FAILED`, `CANNOT_INVITE_SELF`                                           |
| `resend_invitation(p_invitation_id)`                                    | Verified; `OWNER`  | For an invitation whose stored status is `PENDING` or `EXPIRED` on a board the caller owns: new token, new expiry, status back to `PENDING`. Returns `{id, token, expires_at}`.                                                                                                                                                                                                          | `INVITATION_UNAVAILABLE`, `INVITATION_NOT_PENDING`                                                  |
| `revoke_invitation(p_invitation_id)`                                    | Verified; `OWNER`  | Stored status must be `PENDING`. Sets `REVOKED`, logs `INVITATION_REVOKED`.                                                                                                                                                                                                                                                                                                              | `INVITATION_UNAVAILABLE`, `INVITATION_NOT_PENDING`                                                  |
| `list_board_invitations(p_board_id)`                                    | Signed in; `OWNER` | All invitations for the board with their effective status. No token or hash.                                                                                                                                                                                                                                                                                                             | role-check errors                                                                                   |
| `list_my_invitations()`                                                 | Signed in          | Pending, unexpired invitations addressed to the caller's verified email on boards not in Trash, with board title and inviter name and avatar. Empty unless the caller is active and verified.                                                                                                                                                                                            | none                                                                                                |
| `accept_invitation(p_invitation_id default null, p_token default null)` | Verified           | Looks up by token (if 32 to 128 characters) or else by id. The invitation must be addressed to the caller's own verified email and the board must not be in Trash. Adds the membership with the invited role, or upgrades `VIEWER` to `EDITOR`; never downgrades. Marks any pending join request by the caller on that board `APPROVED`. Returns `{status: "ACCEPTED", board_id, role}`. | `INVITATION_UNAVAILABLE`, `INVITATION_EXPIRED`, `INVITATION_REVOKED`, `INVITATION_ALREADY_ACCEPTED` |
| `decline_invitation(p_invitation_id)`                                   | Verified           | Must be addressed to the caller and effectively `PENDING`. Sets `DECLINED`, logs `INVITATION_DECLINED`.                                                                                                                                                                                                                                                                                  | `INVITATION_UNAVAILABLE`                                                                            |

Notes:

- `create_invitation` does not check whether the address already belongs to a member. Accepting such an
  invitation changes nothing unless it upgrades a viewer to editor.
- The database does not send email. The token is returned to the owner, who passes the link on (invitation email
  delivery is listed as future work in the README).

### Canvas operations and snapshots

| Function                                                                                                                                                      | Caller                      | Behaviour                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_operation(p_board_id, p_operation_id, p_type, p_object_id, p_payload default '{}', p_expected_version default null, p_client_timestamp default null)` | Verified; `OWNER`, `EDITOR` | The only write path for the canvas. See [Operation sequencing and conflicts](#operation-sequencing-and-conflicts).                                                |
| `load_board_state(p_board_id)`                                                                                                                                | Signed in; any role         | Returns `{board, snapshot: {sequence, objects}, operations, last_sequence}`: `get_board`, the latest snapshot, and every operation with a higher sequence number. |
| `get_operations_after(p_board_id, p_after, p_limit default 500)`                                                                                              | Signed in; any role         | Returns `{operations, last_sequence}`: operations with sequence greater than `p_after`, in order, at most `p_limit` (clamped to 1..1000).                         |

### Comments, activity and export logging

| Function                                                                    | Caller                                                            | Behaviour                                                                                                                                                                                                | Errors                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `add_comment(p_board_id, p_body, p_object_id default null)`                 | Verified; `OWNER`, `EDITOR`, or `VIEWER` if `viewers_can_comment` | Body 1 to 2000 characters after trimming. An anchor object must be a live object on the same board. Logs `COMMENT_CREATED` and broadcasts on the comments channel. Returns the comment with its author.  | `COMMENTING_DISABLED`, `VALIDATION_FAILED`, `OBJECT_NOT_FOUND`  |
| `update_comment(p_comment_id, p_body)`                                      | Verified; the author                                              | The comment must exist, not be deleted, and be the caller's; the caller must still be allowed to comment on the board. Sets `edited_at`. Logs and broadcasts.                                            | `COMMENT_NOT_FOUND`, `COMMENTING_DISABLED`, `VALIDATION_FAILED` |
| `delete_comment(p_comment_id)`                                              | Verified; the author                                              | The caller must still be a member (any role). Sets `deleted_at` and replaces the body with `[deleted]`. Logs and broadcasts. Nobody else, including the owner, can delete someone's comment.             | `COMMENT_NOT_FOUND`, role-check errors                          |
| `get_board_comments(p_board_id, p_before default null, p_limit default 50)` | Signed in; any role                                               | Non-deleted comments, newest first, optionally older than `p_before`. Limit clamped to 1..100.                                                                                                           | role-check errors                                               |
| `get_board_activity(p_board_id, p_before default null, p_limit default 30)` | Signed in; any role                                               | Newest first. Each row has `id, type, actor_id, object_id, metadata, created_at`, the actor's names and avatar, and `subject_name` when `metadata.user_id` refers to a profile. Limit clamped to 1..100. | role-check errors                                               |
| `record_board_export(p_board_id, p_scope default 'board')`                  | Verified; any role                                                | Called by the client after it has produced a PNG. Scope is `board` or `viewport`. Logs `BOARD_EXPORTED`.                                                                                                 | `VALIDATION_FAILED`                                             |

### Private helpers

Not callable through the API (except the four used by policies). Listed so the public functions above can be
followed.

| Helper                                                                                                                               | Purpose                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `require_user`, `require_verified_user`, `require_board_role`, `require_can_comment`                                                 | The checks described above.                                                                                                           |
| `is_board_member`, `is_board_owner`, `own_verified_email`                                                                            | Used by RLS policies. `is_board_member` is false for a board in Trash; `is_board_owner` compares `boards.owner_id` and ignores Trash. |
| `board_role`                                                                                                                         | Returns the caller's role. Defined but not used by any function or policy.                                                            |
| `board_id_from_topic`                                                                                                                | Parses `board:<uuid>:<channel>`; see [Realtime](realtime.md).                                                                         |
| `random_token`, `hash_token`, `random_collaboration_code`, `random_avatar_seed`, `avatar_url`                                        | Token, code and avatar generation.                                                                                                    |
| `rate_limit_exceeded`, `enforce_rate_limit`                                                                                          | See [Rate limits](#rate-limits).                                                                                                      |
| `log_activity`, `log_security_event`, `broadcast`                                                                                    | Activity rows, security events, and `realtime.send` wrapped so that a Realtime failure only raises a warning.                         |
| `sanitize_props`, `json_number`, `object_state`, `operation_json`, `comment_json`, `profile_json`                                    | Validation and JSON shaping.                                                                                                          |
| `snapshot_board`, `snapshot_interval`, `invitation_ttl`, `effective_invitation_status`, `create_sharing_row`, `plan_rank`, `trim_ws` | Small utilities.                                                                                                                      |

### Triggers

There are exactly three triggers.

| Trigger                        | On                                                                             | Function                      | Effect                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `foreman_on_auth_user_created` | `auth.users`, after insert                                                     | `private.handle_new_user`     | Creates the profile.                                                                                           |
| `foreman_on_auth_user_updated` | `auth.users`, after update of `email`, `email_confirmed_at`, `last_sign_in_at` | `private.handle_user_updated` | Mirrors `email` (lower-cased), `email_verified` and `last_login_at` into the profile when any of them differs. |
| `profiles_touch_updated_at`    | `public.profiles`, before update                                               | `private.touch_updated_at`    | Sets `updated_at`.                                                                                             |

`handle_new_user` reads `first_name`, `last_name`, `username` and `avatar_gender_selection` from
`raw_user_meta_data`. That metadata is supplied by the person signing up, so each field is validated or replaced:
empty names become `New` / `Member`, an invalid username becomes `user_<10 hex>`, an invalid preference is chosen
at random. A username collision is retried with a random suffix. The function returns without doing anything if
the profile already exists, and it is written never to fail the sign-up.

**Activity rows and Realtime broadcasts are not produced by triggers.** They are explicit calls
(`private.log_activity`, `private.broadcast`) inside the functions that make the change, in the same transaction.

## Property sanitising

`private.sanitize_props` builds the stored `props` object from a whitelist; everything else is dropped.

| Key                       | Accepted                                                         | Otherwise                          |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `text`                    | String of at most 5000 characters                                | Longer: `VALIDATION_FAILED`        |
| `fill`, `stroke`, `color` | `#rrggbb` or `transparent`                                       | Dropped                            |
| `strokeWidth`             | Number from 0 to 32                                              | Dropped                            |
| `fontSize`                | Number from 8 to 200                                             | Dropped                            |
| `textAlign`               | `left`, `center`, `right`                                        | Dropped                            |
| `bold`                    | Boolean                                                          | Dropped                            |
| `points`                  | Array of at most 4000 numbers, even length, each within ±100,000 | Anything else: `VALIDATION_FAILED` |

## Collaboration codes

- **Format:** `F-XXX-XXXX`, seven random characters.
- **Alphabet:** `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 characters; no `I`, `O`, `0` or `1`). The check constraint
  on the column is looser (`[A-Z0-9]`), so it accepts characters the generator never produces.
- **Randomness:** bytes taken from two `gen_random_uuid()` values, skipping the bytes that hold the UUID version
  and variant; each byte is reduced modulo 32, which is unbiased for a 32-character alphabet. That is 35 bits,
  about 3.4 × 10^10 codes.
- **Uniqueness:** a unique index. Generation retries on collision up to 10 times, then raises
  `CODE_GENERATION_FAILED`.
- **Normalisation:** `normalize_collaboration_code` removes all whitespace and upper-cases. It does not insert
  missing hyphens. `join_board` then requires the result to match `^F-[A-Z0-9]{3}-[A-Z0-9]{4}$`.
- **A code is a locator, not a credential.** What happens depends on the board's access mode, and the most a code
  or link can grant is `VIEWER`.

`join_board` returns `{status, board_id?}`:

| Status              | When                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `RATE_LIMITED`      | More than 10 lookups in 10 minutes. Logged as the security event `JOIN_RATE_LIMITED`.                                          |
| `UNAVAILABLE`       | Malformed input, unknown code or token, code or link disabled, board in Trash, **or** the board is `PRIVATE` or `INVITE_ONLY`. |
| `ALREADY_MEMBER`    | The caller is already on the board (includes `board_id`).                                                                      |
| `JOINED_VIEWER`     | Board is `LINK_VIEWER`: the caller is added as `VIEWER` and `MEMBER_JOINED` is logged (includes `board_id`).                   |
| `PENDING_APPROVAL`  | Board is `LINK_REQUEST_ACCESS` and the caller already has a pending request.                                                   |
| `ACCESS_DENIED`     | Board is `LINK_REQUEST_ACCESS` and a request by the caller was rejected within the last 7 days.                                |
| `REQUEST_SUBMITTED` | Board is `LINK_REQUEST_ACCESS`: a join request is created and `JOIN_REQUEST_CREATED` is logged.                                |

The same `UNAVAILABLE` answer is used for "does not exist" and "exists but is private", so a private board cannot
be confirmed by guessing codes. Statuses are returned rather than raised so that the rate-limit counter and the
`JOIN_LOOKUP_FAILED` security event are committed. Every call that reaches the function counts toward the limit,
successful or not.

The server action (`joinBoardAction`) answers `UNAVAILABLE` for a malformed code without calling the database, so
those attempts are neither counted nor logged.

## Invitation and share-link tokens

Both kinds of token come from `private.random_token()`: two `gen_random_uuid()` values, hex-encoded, giving a
64-character string with 244 random bits. Only `encode(sha256(token), 'hex')` is stored; the raw token is returned
once, by the function that created it, and cannot be recovered afterwards.

|                | Invitation token                                                                                           | Share-link token                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Stored in      | `board_invitations.token_hash` (unique)                                                                    | `board_sharing.share_token_hash` (unique where not null)                              |
| Returned by    | `create_invitation`, `resend_invitation`                                                                   | `regenerate_share_link`                                                               |
| Expiry         | `expires_at = now() + invitation_ttl_days` (7 days, from `private.settings`)                               | None. Valid until disabled or regenerated.                                            |
| Invalidated by | Renewing or resending (new hash), revoking, accepting, declining, expiry, switching the board to `PRIVATE` | `regenerate_share_link` (new hash) or `update_sharing(p_share_link_enabled => false)` |
| What it grants | The invited role, **only** to the account whose verified email equals `invitee_email`                      | Whatever the board's access mode allows; at most `VIEWER`                             |

A forwarded invitation link is useless to anyone else: `accept_invitation` compares the invitation's address with
the caller's own verified email and answers `INVITATION_UNAVAILABLE` on a mismatch, the same answer as for a
token that does not exist.

## Operation sequencing and conflicts

`submit_operation` does the following, in order, in one transaction.

1. Caller must be verified and `OWNER` or `EDITOR` of the board.
2. Validates the envelope: non-null operation and object ids, a known operation type, a JSON-object payload of at
   most 65,536 bytes (measured on its text form). Otherwise `VALIDATION_FAILED`.
3. Applies the rate limit.
4. Locks the board row (`select ... for update`). This serialises writers on a board.
5. **Deduplication.** If `(board_id, operation_id)` already exists, returns
   `{status: "duplicate", sequence, object, last_sequence}`, where `sequence` is the original operation's and
   `object` is the object's _current_ state. Nothing is written and nothing is broadcast.
6. Locks the object row. If the id belongs to an object on a different board: `VALIDATION_FAILED` (it does not
   confirm that the id exists elsewhere).
7. Applies the operation by type (table below). A conflict is _returned_ as
   `{status: "conflict", code, object, last_sequence}` with the current server state; it writes nothing, consumes
   no sequence number and is not broadcast.
8. On success: sets `boards.last_sequence = last_sequence + 1` and `updated_at`, inserts the `board_operations`
   row with that sequence number, logs activity, takes a snapshot if due, then calls `realtime.send`. Returns
   `{status: "accepted", sequence, object, last_sequence}`.

Because the sequence number is assigned under the board lock and only on success, numbers are strictly increasing
and gap-free per board. The operation row is written before the broadcast and in the same transaction, so a
broadcast always describes a committed operation.

| Type              | Requirements                                                                                                                         | Effect                                                                                      | Conflicts and errors                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_CREATED`  | Payload has `type` (one of the six creatable types) and numeric `x`, `y`, `width`, `height`. Board has fewer than 5000 live objects. | Inserts the object at version 1. `z_index` is the payload's, or the board's maximum plus 1. | Conflict `OBJECT_EXISTS` if the id is already used on this board. Errors `IMAGE_UPLOAD_DISABLED`, `BOARD_OBJECT_LIMIT`, `VALIDATION_FAILED`. |
| `OBJECT_MOVED`    | Numeric `x` and `y`.                                                                                                                 | Sets position.                                                                              | Conflict `OBJECT_DELETED`. Errors `OBJECT_NOT_FOUND`, `VALIDATION_FAILED`.                                                                   |
| `OBJECT_UPDATED`  | Any of `x`, `y`, `width`, `height`, `rotation`, `z_index`, `props`.                                                                  | Sets the given geometry; merges sanitised `props` into the stored ones.                     | Conflict `OBJECT_DELETED`; conflict `TEXT_CONFLICT` (below). Error `OBJECT_NOT_FOUND`.                                                       |
| `OBJECT_DELETED`  | Object exists and is live.                                                                                                           | Sets `deleted_at`.                                                                          | Conflict `OBJECT_DELETED` if already deleted. Error `OBJECT_NOT_FOUND`.                                                                      |
| `OBJECT_RESTORED` | Object exists and is deleted.                                                                                                        | Clears `deleted_at`.                                                                        | Conflict `OBJECT_NOT_DELETED`. Error `OBJECT_NOT_FOUND`.                                                                                     |

Every accepted operation increments the object's `version` by one. A value that violates a column check or
overflows is reported as `VALIDATION_FAILED`.

Conflict rules:

- **Position, size and style: last accepted operation wins.** `p_expected_version` is ignored for these.
- **Deletion wins.** Once an object is deleted, later moves and updates return `OBJECT_DELETED`. Only
  `OBJECT_RESTORED` brings it back.
- **Text needs the current version.** An `OBJECT_UPDATED` whose `props` contains the key `text` is accepted only
  if `p_expected_version` equals the object's current version; null counts as a mismatch. Note that _any_
  accepted operation on the object bumps the version, so a text edit also conflicts with, for example, someone
  else's move of the same object made in between.

A retry of an operation that was answered with a conflict is not a duplicate (conflicts are not recorded); it is
evaluated again.

### Snapshots

- A snapshot at sequence 0 is written when a board is created or duplicated. It contains the template or copied
  objects, which are not represented as operations.
- After an accepted operation, a snapshot is written when `sequence % snapshot_interval = 0`.
  `snapshot_interval` is read from `private.settings` (50) and floored at 1.
- A snapshot contains only non-deleted objects.
- Nothing prunes old snapshots or operations.

### Activity entries for operations

Each accepted operation also logs activity with the operation type and `metadata.object_type`. For
`OBJECT_MOVED` and `OBJECT_UPDATED`, a repeat by the same person on the same object within 60 seconds updates the
existing row (its `created_at` moves forward and `metadata.repeat` counts up) instead of inserting a new one.

## Rate limits

`private.rate_limit_exceeded(action, max, window)` keeps one row per `(user, action)` in `private.rate_limits`.
It is a fixed window: the first call starts the window; each call increments `hits`; a call is over the limit when
`hits > max`; once the window has passed, the next call resets the counter to 1.

| Action key            | Limit          | Functions                                         | When over the limit                                   |
| --------------------- | -------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `operation`           | 600 per minute | `submit_operation`                                | raises `RATE_LIMITED`                                 |
| `comment`             | 60 per 10 min  | `add_comment`, `update_comment` (shared)          | raises `RATE_LIMITED`                                 |
| `join_lookup`         | 10 per 10 min  | `join_board`                                      | **returns** `{status: "RATE_LIMITED"}`, logs an event |
| `invitation_response` | 30 per 10 min  | `accept_invitation`                               | raises `RATE_LIMITED`                                 |
| `invite`              | 30 per hour    | `create_invitation`, `resend_invitation` (shared) | raises `RATE_LIMITED`                                 |
| `create_board`        | 30 per hour    | `create_board`, `duplicate_board` (shared)        | raises `RATE_LIMITED`                                 |
| `regenerate_code`     | 20 per hour    | `regenerate_collaboration_code`                   | raises `RATE_LIMITED`                                 |
| `regenerate_link`     | 20 per hour    | `regenerate_share_link`                           | raises `RATE_LIMITED`                                 |
| `export`              | 30 per 10 min  | `record_board_export`                             | raises `RATE_LIMITED`                                 |
| `avatar`              | 30 per hour    | `regenerate_avatar`                               | raises `RATE_LIMITED`                                 |
| `cookie_consent`      | 20 per hour    | `record_cookie_consent`                           | raises `RATE_LIMITED`                                 |
| `data_export`         | 5 per hour     | `export_my_data`                                  | raises `RATE_LIMITED`                                 |
| `account_deletion`    | 5 per hour     | `request_account_deletion`                        | raises `RATE_LIMITED`                                 |

One consequence of how this is built: the counter update is part of the calling transaction, so a call that ends
in an exception does not count. For every function except `join_board` that means **only calls that succeed (or
return a conflict or duplicate) are counted**. In particular, failed `accept_invitation` attempts (wrong or
unknown token) do not consume the `invitation_response` budget. `join_board` is the only function written to
record failed attempts.

Functions not in the table (for example `delete_comment`, `decline_invitation`, `username_available`, and all the
read functions) have no database rate limit. Supabase Auth's own limits on sign-up, sign-in and email are
separate and configured in the dashboard.

## Account deletion

`request_account_deletion(p_confirmation)` is a soft delete.

1. `p_confirmation` must be exactly `DELETE MY ACCOUNT`, otherwise `CONFIRMATION_MISMATCH`.
2. If the caller owns any board (not in Trash) that has other members: `OWNED_BOARDS_REQUIRE_TRANSFER`. They must
   transfer ownership or remove the members first.
3. Otherwise, in one transaction: the caller's remaining owned boards are moved to Trash; their non-owner
   memberships are deleted; pending invitations they sent are revoked; their pending join requests are deleted;
   the profile gets `status = 'PENDING_DELETION'` and `deleted_at = now()`; the security event
   `ACCOUNT_DELETION_REQUESTED` is logged.

Afterwards every function that requires a verified caller answers `ACCOUNT_INACTIVE`. The application
(`deleteAccountAction` in `src/lib/auth/actions.ts`) re-checks the password before the call and signs out all
sessions after it, and `getCurrentProfile` treats a non-`ACTIVE` profile as signed out. The database itself does
not revoke sessions: functions that only require a signed-in caller (the read functions, for example
`list_boards('trash')`) still answer for a `PENDING_DELETION` account that presents a valid token.

**What is left to an operator.** Nothing in the migrations completes the deletion:

- No function sets `status = 'DELETED'`, purges the trashed boards, or deletes the `auth.users` row.
- Deleting the `auth.users` row cascades to `profiles`, but `boards.owner_id` is `on delete restrict`. The
  deletion therefore fails while the profile still owns any board, including boards in Trash. The operator must
  delete those boards first (as the database owner; `purge_board` is refused for an inactive account), then delete
  the auth user from the dashboard or the admin API.
- Once the profile is gone, the foreign keys do the rest: memberships, invitations sent, join requests and
  consent rows are deleted; authorship columns (`actor_id`, `author_id`, `created_by`, `updated_by`,
  `uploader_id`, `decided_by`, `accepted_by`, `security_events.user_id`) are set to null, so comments and history
  on other people's boards remain without an author.

The comment on the function in the migration points to [Security](security.md) for the operator procedure.

## Template seed

`20261008000800_seed_templates.sql` is generated from `src/lib/templates/catalog.ts` by `buildTemplateSeedSql()`.
Do not edit it by hand.

```bash
npm run db:generate-templates
```

That script runs `tests/unit/template-seed.test.ts` with `UPDATE_TEMPLATE_SEED=1`, which rewrites the migration
file. Without the variable the same test **fails if the file differs from what the catalog would generate**, so the
catalog and the seed cannot drift apart unnoticed. The test also checks that there are six templates with unique
slugs and that they only use supported object types.

The seed is one `insert ... on conflict (slug) do update`, so re-running it updates the six rows in place. Note
that `supabase db push` does not re-run a migration it has already recorded; after changing the catalog on an
existing project, apply the regenerated file through the SQL editor or ship the change as a new migration.

## Differences between the test database and real Supabase

`tests/db/supabase-shim.sql` provides only what the migrations reference. It is never applied to a real database.

| Area                | In the tests                                                                                                            | On real Supabase                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Engine              | PGlite, in-process, one connection.                                                                                     | Managed Postgres with concurrent connections. Row locking in `submit_operation` has not been exercised under real concurrency. |
| Roles               | `anon`, `authenticated`, `service_role` created as bare roles.                                                          | Supabase's roles, plus `authenticator`, `supabase_auth_admin` and others that the shim does not have.                          |
| `auth.users`        | A six-column table. Tests insert rows directly to simulate sign-up.                                                     | Written by Supabase Auth as `supabase_auth_admin`. The triggers have not been fired by the real Auth service.                  |
| `auth.uid()`        | Reads `request.jwt.claims` / `request.jwt.claim.sub`, set by the harness with `set_config`.                             | Set by PostgREST and Realtime from a verified JWT.                                                                             |
| API layer           | The harness calls `select public.fn(name => $1, ...)` after `set role`.                                                 | PostgREST `/rpc`. Argument naming, JSON casting and error serialisation are PostgREST's.                                       |
| `realtime.messages` | A plain table with `topic, extension, payload, event, private, inserted_at`.                                            | Supabase's partitioned table, with its own columns, grants and retention.                                                      |
| `realtime.send()`   | Inserts a row with `extension = 'broadcast'`.                                                                           | Supabase's function; delivery to WebSocket clients happens in the Realtime service.                                            |
| `realtime.topic()`  | Reads the `realtime.topic` setting, set by the harness.                                                                 | Set by the Realtime service when it evaluates channel policies.                                                                |
| Default privileges  | Reproduced for `public` (grant all on new tables, functions and sequences to the API roles), so the revokes are tested. | Supabase's actual defaults; they may differ in detail between project versions.                                                |
| Not present at all  | PostgREST, GoTrue, the Realtime server, the dashboard, extensions, connection pooling.                                  |                                                                                                                                |

So the tests prove what the SQL does once a caller's identity and a channel topic are established. They do not
prove that Supabase establishes them the way the shim assumes.

## Supabase settings the schema depends on

Only what the SQL actually relies on is listed. Items marked **confirm** have not been checked against a live
project.

**Authentication**

- **Confirm email: on.** Every write function requires `profiles.email_verified`, which mirrors
  `auth.users.email_confirmed_at`. With confirmation turned off Supabase marks addresses as confirmed at sign-up,
  nothing breaks, and the gate stops meaning anything.
- **Sign-up metadata.** The profile trigger reads `first_name`, `last_name`, `username` and
  `avatar_gender_selection` from the user metadata that the sign-up form sends.
- **Access-token lifetime: short (an hour or less).** Realtime keeps a connection's channel authorisation until
  its token is replaced, so this bounds how long a removed member can keep listening. See [Realtime](realtime.md).
- **Confirm:** that Supabase Auth's insert into `auth.users` fires `foreman_on_auth_user_created` successfully.
  The trigger function is `SECURITY DEFINER`, lives in `private`, and has had `EXECUTE` revoked from `public`;
  this arrangement works in the test database but has not been run with `supabase_auth_admin` as the inserting
  role.
- **Confirm:** that an update of `last_sign_in_at` or `email_confirmed_at` by Supabase Auth fires
  `foreman_on_auth_user_updated` (it is declared `after update of` those columns).

**API**

- **Exposed schemas: `public` (and Supabase's `graphql_public`). Never `private`.**
- The application uses only the anon/publishable key with the user's session. No function requires the
  service-role key.

**Realtime**

- `realtime.send(jsonb, text, text, boolean)` and `realtime.topic()` must exist, and RLS must be enabled on
  `realtime.messages`. Migration 0700 assumes all three (its comment says RLS "is already enabled by Supabase")
  and does not create or enable anything itself. **Confirm** on your project.
- Database-originated broadcasts are sent with `private = true`, and clients join with `private: true`, so
  Realtime Authorization must be available for the project. **Confirm** that messages written by
  `realtime.send` reach subscribed clients.
- The migrations do not depend on the "allow public access" channel setting. Turning public access off is a
  reasonable hardening step, but it is not something the SQL requires, and its effect here is **unconfirmed**.
- No table is added to a `postgres_changes` publication; Foreman does not use Postgres Changes.

**Not used**

Storage buckets, Edge Functions, `pg_cron`, database webhooks and extensions are not required by anything in
`supabase/migrations`.
