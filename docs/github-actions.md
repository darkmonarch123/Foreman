# GitHub Actions

> **These workflows have never executed.** Both files were written and reviewed without a GitHub repository to
> run them in. Every command they call has been run locally and passes (see [Testing](testing.md)), but the
> workflow files themselves, the runner environment and the Render deploy hook call are unverified. Watch the
> first runs closely.

There are two workflows in `.github/workflows`:

| File         | Name               | Purpose                                                                      |
| ------------ | ------------------ | ---------------------------------------------------------------------------- |
| `ci.yml`     | `CI`               | Checks every pull request and every push to `main`.                          |
| `deploy.yml` | `Deploy to Render` | After `CI` succeeds for a push to `main`, asks Render to deploy that commit. |

```
pull request ---------> CI -----------> (nothing further)

push to main ---------> CI --success--> Deploy to Render --POST--> Render deploy hook
                           \--failure or cancelled--> deploy job skipped
```

## `ci.yml`

### Triggers

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

- Every pull request, whatever its target branch, on the default activity types (opened, new commits pushed,
  reopened).
- Every push to `main`.

Pushes to other branches do not run CI unless they belong to a pull request.

### Workflow-level settings

| Setting       | Value                                                    | Effect                                                                                                        |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `concurrency` | group `ci-${{ github.ref }}`, `cancel-in-progress: true` | A newer run for the same ref cancels the one in progress. This applies to `main` as well as to pull requests. |
| `permissions` | `contents: read`                                         | The workflow token can read the repository and nothing else.                                                  |
| `env`         | four variables, below                                    | Available to every step in both jobs.                                                                         |

Environment variables set in the file:

| Variable                        | Value                                     | Why                                                                                          |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NEXT_TELEMETRY_DISABLED`       | `1`                                       | Turns off Next.js telemetry.                                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://placeholder-project.supabase.co` | A placeholder, not a secret. Makes `next build` compile the "Supabase configured" code path. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `placeholder-anon-key`                    | Same.                                                                                        |
| `NEXT_PUBLIC_SITE_URL`          | `http://localhost:3000`                   | Same.                                                                                        |

No request is made to the placeholder host. The tests that need Supabase either mock it or use the in-process
database, and the build does not contact it.

### Jobs

The two jobs are independent (neither has `needs`), so they run in parallel. Each runs on `ubuntu-latest` with a
20-minute timeout.

#### `verify`: "Format, lint, types, tests, build"

| Step                               | Command or action                                             | Notes                                                                 |
| ---------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Check out                          | `actions/checkout@v4`                                         |                                                                       |
| Set up Node.js                     | `actions/setup-node@v4` with `node-version: 22`, `cache: npm` |                                                                       |
| Install dependencies (locked)      | `npm ci`                                                      | Installs exactly what `package-lock.json` specifies.                  |
| Check formatting                   | `npm run format:check`                                        | `prettier --check .`                                                  |
| Lint                               | `npm run lint`                                                | `eslint`                                                              |
| Type-check                         | `npm run typecheck`                                           | `next typegen && tsc --noEmit`                                        |
| Unit, component and database tests | `npm run test`                                                | `vitest run`: all of `tests/unit`, `tests/components` and `tests/db`. |
| Production build                   | `npm run build`                                               | `next build`, with the placeholder values above.                      |

The steps run in that order and the job stops at the first failure. The database tests need no service
container: they apply the migrations to PGlite inside the test process.

#### `browser`: "Board in a real browser"

| Step                          | Command or action                                             | Notes                                                                          |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Check out                     | `actions/checkout@v4`                                         |                                                                                |
| Set up Node.js                | `actions/setup-node@v4` with `node-version: 22`, `cache: npm` |                                                                                |
| Install dependencies (locked) | `npm ci`                                                      |                                                                                |
| Install Chromium              | `npx playwright install --with-deps chromium`                 | See [How the browser tests get Chromium](#how-the-browser-tests-get-chromium). |
| Board browser tests           | `npm run test:browser`                                        | `playwright test --project=board`                                              |
| Upload traces on failure      | `actions/upload-artifact@v4`, `if: failure()`                 | Uploads `test-results/` as `playwright-traces`, kept for 7 days.               |

Because GitHub sets `CI=true` on its runners, `playwright.config.ts` behaves slightly differently from a local
run: each failing test is retried once, results are reported with the `github` and `list` reporters, and
Playwright always starts its own Vite server for the test harness instead of reusing one.

### Node.js version

Both jobs use `node-version: 22`, which selects the latest Node.js 22 release available to the action. This
matches `engines.node` (`>=22.12.0`) in `package.json` and `NODE_VERSION` in `render.yaml`.

### Caching

- `cache: npm` on `actions/setup-node` caches npm's download cache, keyed on `package-lock.json`. It does not
  cache `node_modules`; `npm ci` still runs in full on every job, with fewer downloads.
- Nothing else is cached: not the Next.js build cache (`.next/cache`), not Playwright's browsers.

### How the browser tests get Chromium

`npx playwright install --with-deps chromium` downloads the Chromium build that matches the installed
`@playwright/test` version and installs the operating-system packages it needs. It runs on every `browser` job.

`playwright.config.ts` only uses a different browser when `PLAYWRIGHT_CHROMIUM_PATH` is set. The workflow does
not set it, so CI uses the browser Playwright just downloaded.

### What CI does not run

- **The end-to-end suite** (`npm run test:e2e`). It needs a real Supabase project and two verified accounts,
  and without its variables it is skipped and exits successfully, which would look like a pass. Run it by hand;
  see [Testing](testing.md#end-to-end-tests-testse2e).
- Anything against a real Supabase project or the deployed site.

A green CI run therefore means exactly what the first four rows of the README's status table say, and no more.

## `deploy.yml`

### Trigger

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
```

The workflow starts whenever a run of the workflow named `CI` finishes for the `main` branch, whatever its
result. The job then decides whether to do anything:

```yaml
if: >-
  github.event.workflow_run.conclusion == 'success' &&
  github.event.workflow_run.event == 'push'
```

- CI failed or was cancelled: the job is skipped.
- CI ran for a pull request rather than a push: the job is skipped. Pull requests are never deployed.

Things that follow from using `workflow_run`:

- GitHub only triggers `workflow_run` workflows from the copy of the file on the repository's default branch.
  `deploy.yml` does nothing until it has been merged there.
- The link to CI is by **name**. If the `name:` in `ci.yml` is changed from `CI`, deploys silently stop.
- Both workflows assume the default branch is called `main`.

### Workflow-level settings

| Setting       | Value                                                  | Effect                                                                                  |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `permissions` | `contents: read`                                       | Minimal token. The job does not check out the repository.                               |
| `concurrency` | group `deploy-production`, `cancel-in-progress: false` | Deploy runs do not overlap, and one that has started is never cancelled by a later one. |

### The job

`deploy` ("Trigger Render deploy") runs on `ubuntu-latest` with a 5-minute timeout and has one step, "Trigger
the deploy hook". In order, the step:

1. Reads two environment variables: `RENDER_DEPLOY_HOOK_URL` from the repository secret of the same name, and
   `COMMIT_SHA` from `github.event.workflow_run.head_sha` (the commit CI just passed for).
2. If `RENDER_DEPLOY_HOOK_URL` is empty, prints a notice and exits successfully. See
   [When the secret is absent](#when-the-secret-is-absent).
3. Sends `POST ${RENDER_DEPLOY_HOOK_URL}&ref=${COMMIT_SHA}` with `curl`, with a 30-second limit, discarding the
   response body and keeping the HTTP status.
4. Prints the status. Any `2xx` is success; anything else fails the job with "Render did not accept the deploy
   request."

The `ref` parameter asks Render to deploy the specific commit that passed CI, rather than whatever is at the
head of the branch by the time Render starts.

The secret is passed through the step's environment instead of being interpolated into the script, so it does
not appear in the command text, and `curl` runs with `--silent` so it prints no progress output.

What the job does **not** do:

- It does not wait for the Render deploy to finish and does not check its health. A green job means Render
  accepted the request. Whether the build and deploy then succeeded is visible only in the Render dashboard.
- It does not apply database migrations. Apply those to Supabase separately, before the application version
  that needs them goes live (see [Deployment on Render](deployment-render.md#deploying-changes)).

## Secrets and variables

The workflows reference exactly one repository secret and no repository variables (`vars.*`).

| Name                     | Kind   | Used in      | Purpose                                                                                      |
| ------------------------ | ------ | ------------ | -------------------------------------------------------------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL` | Secret | `deploy.yml` | The Render service's deploy hook URL. Anyone who has it can trigger a deploy of the service. |

Not needed in GitHub at all:

- **Supabase values.** CI uses the placeholders written in `ci.yml`. The real `NEXT_PUBLIC_*` values live on the
  Render service, where the production build happens.
- **`SUPABASE_SERVICE_ROLE_KEY`.** Not used by the application or by any workflow.
- **`E2E_*` variables.** The workflows do not run the end-to-end suite.

The only other credential involved is the automatic `GITHUB_TOKEN`, restricted to `contents: read`.

### Getting the deploy hook URL and storing it

1. Create the Render service first ([Deployment on Render](deployment-render.md)).
2. In the Render dashboard open the service, go to **Settings**, find **Deploy Hook** and copy the URL. It
   looks like `https://api.render.com/deploy/srv-…?key=…`. The `key` part is the secret.
3. In the GitHub repository go to **Settings → Secrets and variables → Actions → New repository secret**.
4. Name: `RENDER_DEPLOY_HOOK_URL`. Value: the URL exactly as copied, on one line with no trailing space.
5. Save.

Notes:

- Store the whole URL including `?key=…`. The workflow appends `&ref=<sha>`, which is only valid if the URL
  already has a query string. Render's hook URLs do.
- Treat the URL as a password. If it leaks, regenerate the hook in the Render service's settings and update the
  secret.
- `render.yaml` sets `autoDeploy: false`, so the hook (or a manual deploy) is the only thing that deploys. If
  auto-deploy is switched on in Render as well, each push to `main` would be deployed twice: once by Render
  straight away, before CI has finished, and once by this workflow.

### When the secret is absent

If `RENDER_DEPLOY_HOOK_URL` is not defined, the step prints

```
RENDER_DEPLOY_HOOK_URL is not set, so nothing was deployed.
```

as a workflow notice and exits with status 0. The job and the workflow are reported as **successful**.

This is deliberate: a fork, or a repository that has not been connected to Render yet, gets a working CI
pipeline without a permanently failing deploy job. The consequence is that a green "Deploy to Render" run is
not proof that anything was deployed. Open the run and read the step's output, or check the service's deploy
list in Render.

Removing the secret is also the quickest way to pause automatic deploys.

## Behaviour worth knowing before the first run

These follow from reading the files. None has been observed.

- **Rapid pushes to `main`.** CI's concurrency setting cancels the in-progress run for `main` when a newer
  commit arrives. A cancelled run does not trigger a deploy, so only the newest commit is deployed. That is
  normally what you want, but it means not every commit on `main` gets its own completed CI run.
- **Re-running CI.** Re-running a successful CI run for a push to `main` completes it again, and can be expected
  to trigger the deploy workflow again for the same commit.
- **Network failure in the deploy step.** If `curl` itself fails (timeout, DNS), the step exits with `curl`'s
  error before reaching the "Render did not accept" message. The job still fails, with a less specific message.
- **Timing.** `npx playwright install --with-deps` downloads a browser and installs system packages on every
  run. If the `browser` job is slow, caching Playwright's browser directory is the first thing to add.
- **Action versions.** Actions are referenced by major version tag (`@v4`), not pinned to a commit.

## Suggested branch protection

Not configured by anything in the repository; set it under **Settings → Branches** (or as a ruleset) for
`main`:

- Require a pull request before merging.
- Require status checks to pass, and select both CI jobs by their names:
  - `Format, lint, types, tests, build`
  - `Board in a real browser`
- Require branches to be up to date before merging, so the checks ran against the code that will land.
- Do not allow force pushes or deletion.

Do not add `Trigger Render deploy` as a required check. It runs after the merge, on `main`, and never on the
pull request itself.

With this in place the path to production is: pull request → both CI jobs green → merge → CI runs again on
`main` → deploy hook → Render builds and deploys that commit.

## First-run checklist

1. Push the repository to GitHub with `main` as the default branch.
2. Open a pull request and confirm both CI jobs start and finish. If the `browser` job fails, download the
   `playwright-traces` artifact and open a trace with `npx playwright show-trace`.
3. Merge. Confirm CI runs on `main`, then that "Deploy to Render" runs and, with no secret yet, prints the
   "not set" notice.
4. Create the Render service, add the `RENDER_DEPLOY_HOOK_URL` secret, and push another commit to `main`.
5. Confirm the deploy step prints `Render responded with HTTP` followed by a 2xx status, and that a deploy for
   that commit appears in the Render dashboard.
6. Update the README's status table once these have actually been seen to work.
