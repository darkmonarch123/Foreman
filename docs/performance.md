# Performance

How Foreman measures speed, what the query audit found, and the caching rules. Added in the v1.1 UI and
performance work.

## What is measured

Nine actions are timed, in the browser and on the server:

| Action                     | Where it is timed                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `board_open`               | Server: loading the board page data. Browser: page start to the first painted canvas.                         |
| `canvas_first_interaction` | Browser: the first pointer press on the canvas to the next paint.                                             |
| `object_create`            | Browser: the create action to the optimistic object being painted.                                            |
| `object_move`              | Browser: the end of a drag to the moved object being painted.                                                 |
| `comment_create`           | Browser: Post comment to the comment being shown (or the error).                                              |
| `assistant_run`            | Browser: Run to the findings being painted. Server: snapshot, rules, storing the findings.                    |
| `proposal_accept`          | Browser: Accept to the result. Server: the accept transaction, with its outcome (`ok`, `stale`, `rejected`…). |
| `template_search`          | Browser: a filter or search keystroke to the filtered gallery being painted. Server: loading the catalog.     |
| `dashboard_load`           | Server: listing boards. Browser: page start to first paint.                                                   |

### What a timing contains

Only: action, duration in milliseconds, outcome (`ok`, `error`, `stale`, `rejected`, `cancelled`), an error code,
the board id and the user id. Nothing else can be logged: the event type has no field for note text, comment text,
drawing data, guidance, titles or e-mail addresses (`src/lib/perf/events.ts`).

- Server timings are one JSON line each with `"scope":"perf"` (`src/lib/perf/server.ts`). In Render, filter the
  logs on `"scope":"perf"`.
- Browser timings are batched to `POST /api/perf` with `sendBeacon`. The route takes at most 20 events and 8 KB,
  validates each event strictly (an unknown field drops that event), takes the user id from the session cookie
  (never from the request body), drops events from signed-out visitors, and always answers `204`.
- In the browser, the last 200 timings are also kept in `window.__foremanPerf` for local inspection.

### Query timings

Set `FOREMAN_QUERY_TIMING=1` (or run outside production) and every database call made through `timedQuery`
records `{name, ms}`; tests read them with `queryLog()`.

## Query audit

Round trips per action, from the application server to Supabase, measured by counting calls in the unit tests
(`tests/unit/board-data.test.ts`, `tests/unit/assistant-actions.test.ts`):

| Action                 | Before                                         | After                                                      | Change                         |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| Open a board           | 3 in sequence: profile, board state, members   | 2: profile, then `load_board_page` (state + members)       | One fewer sequential trip      |
| Run the Assistant      | 4 in sequence: check, objects, comments, store | 2: `assistant_board_snapshot`, then `assistant_create_run` | Half the trips                 |
| Template search        | A server round trip per search, full content   | None: the cached catalog is filtered in the browser        | Results change as you type     |
| Templates page load    | Query per request                              | Cached public catalog (see caching), one query per hour    |                                |
| Dashboard, comments, … | One RPC each                                   | Unchanged                                                  | Already one call; no N+1 found |

Latency per round trip depends on the distance between the Render region and the Supabase region (typically
20–80 ms between nearby regions), so removing a sequential trip saves roughly that much on every board open and
two of them on every Assistant run. Use the `perf` log lines above to see real numbers for your deployment.

### Indexes added

From `20261104000100_performance.sql`, for lookups the audit found scanning whole tables:

- `board_comments (author_id)`, `board_activity (actor_id)`, `board_operations (actor_id)`: account export and
  account deletion look up a person's rows across all boards.
- `board_comments (board_id) where deleted_at is null`: live comments for the Assistant snapshot.
- `assistant_proposals (created_by, board_id, status, created_at desc)`: listing a person's proposals.

The two new functions run exactly the same permission checks as the ones they replace, in the same order, as the
signed-in user. `load_board_page` is `SECURITY INVOKER` and simply calls the two existing functions.

## Caching rules

- **Only the public template catalog is cached across users.** `listTemplates()` uses `"use cache"` with a
  session-less client and `is_published = true`, which is exactly what anonymous visitors may already read under
  RLS. It is tagged `templates` and kept for up to an hour.
- **Nothing private is cached across users.** No board, member, comment, profile or Assistant data is cached
  anywhere on the server. A test (`tests/unit/caching-safety.test.ts`) fails if a `"use cache"` directive
  appears anywhere else, if the cached scope reads cookies or a session, or if `"use cache: private"` is used.
- **Never stale after a mutation.** Board mutations revalidate `/dashboard`; the board itself is always read
  live, and the client applies changes optimistically and reconciles with the server's answer.
- RLS is never bypassed: there is no service-role key in the application.

## Perceived speed

- Optimistic UI with rollback: board edits (existing engine), Assistant feedback (rolls back if saving fails).
- Skeletons, not full-page spinners: dashboard, templates, board panels, Assistant results.
- Suspense boundaries around each data-loading section.
- Progressive Assistant results: the five most useful findings first, the rest on request.
- Template search runs in the browser, with no request per keystroke.
