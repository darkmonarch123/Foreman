# Deployment on Render

> **This deployment has not been performed.** `render.yaml` and these instructions were written from the code
> and from Render's and Supabase's documentation, without access to a Render account or a live Supabase
> project. The production build (`npm run build`) has been verified locally; nothing after that has. Expect to
> adjust details the first time through, and use the [verification checklist](#6-verify-the-deployment) before
> relying on the result.

Foreman deploys as **one Render web service** running `next start` on Node.js, plus **one managed Supabase
project** that provides the database, authentication and realtime. There is no Dockerfile, no reverse proxy, no
background worker and no persistent disk. Render terminates TLS and forwards requests to the Node process.

## What you need

- A Supabase project (any plan).
- A Render account and this repository on GitHub (or another Git provider Render supports).

## Order of operations

The order matters because the public Supabase values are compiled into the application at build time, and
because Supabase must know the final public URL before it will send working email links.

1. Create the Supabase project and apply the migrations.
2. Decide the service name, and therefore the expected URL.
3. Create the Render service with its environment variables. The first build runs.
4. Confirm the real URL. If it differs from what you expected, correct `NEXT_PUBLIC_SITE_URL` and rebuild.
5. Point Supabase Auth at that URL.
6. Verify.

## 1. Create the Supabase project and apply migrations

Follow [Supabase setup in the README](../README.md#supabase-setup) and
[Supabase schema and policies](supabase-schema.md). In short:

1. Create the project.
2. Apply every file in `supabase/migrations` in filename order (`20261008000100_schema.sql` through
   `20261008000800_seed_templates.sql`), with the Supabase CLI (`supabase link --project-ref <ref>` then
   `supabase db push`) or by pasting each file into the SQL editor in order.
3. In **Authentication → Sign In / Providers → Email**, enable email sign-in, turn **Confirm email** on and set
   the minimum password length to 10.
4. Leave the API's exposed schemas as they are. Do not expose `private`.

From **Project Settings → API**, note two values for step 3:

- the **Project URL** (`https://<project-ref>.supabase.co`);
- the **anon** (or publishable) key.

Do not copy the service-role key anywhere. The application does not use it.

Do this before creating the Render service. A build without the Supabase values succeeds, but produces an
application that treats Supabase as "not configured" (see [Environment variables](#environment-variables)).

## 2. Decide the URL

A Render web service gets a URL of the form `https://<service-name>.onrender.com`. `render.yaml` names the
service `foreman`, so the expected URL is `https://foreman.onrender.com`. Subdomains under `onrender.com` are
shared by all Render users, so that name may already be taken, in which case Render assigns a different
subdomain. You will only know the real one after the service exists; step 4 handles that.

If you intend to use a custom domain, use that origin wherever these instructions say "the public URL", and add
the domain to the service in the Render dashboard.

## 3. Create the Render web service

### Option A: Blueprint (uses `render.yaml`)

`render.yaml` in the repository root defines the service:

| Field             | Value                     | Meaning                                                                                   |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `type`            | `web`                     | A web service with a public URL.                                                          |
| `name`            | `foreman`                 | Service name and requested subdomain.                                                     |
| `runtime`         | `node`                    | Render's native Node.js runtime. No Docker.                                               |
| `plan`            | `free`                    | Free instance type. Change it here or in the dashboard to use a paid instance.            |
| `autoDeploy`      | `false`                   | Render does not deploy on every push. Deploys are triggered by GitHub Actions or by hand. |
| `buildCommand`    | `npm ci && npm run build` | Locked install, then `next build`.                                                        |
| `startCommand`    | `npm run start`           | `next start`.                                                                             |
| `healthCheckPath` | `/api/health`             | See [Health check](#health-check).                                                        |
| `envVars`         | six entries               | See [Environment variables](#environment-variables).                                      |

Steps:

1. In the Render dashboard choose **New → Blueprint** and connect the repository.
2. Render reads `render.yaml` and shows the `foreman` service. It asks for a value for each variable marked
   `sync: false`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` and
   `NEXT_PUBLIC_APP_URL`. Enter them as described in the table below.
3. Apply. Render creates the service and runs the first build and deploy.

Render asks for `sync: false` values only when the Blueprint is first created. Later changes to those variables
are made on the service's **Environment** page, not in `render.yaml`.

`autoDeploy` is the older spelling of this setting; Render's current Blueprint reference documents
`autoDeployTrigger: off` as its replacement. The file has not been applied to Render, so if the Blueprint is
rejected or auto-deploy turns out to be on, check that field first and confirm the setting under the service's
**Settings**.

### Option B: manual

1. **New → Web Service**, connect the repository, choose the `main` branch.
2. Language/runtime: **Node**.
3. Build command: `npm ci && npm run build`
4. Start command: `npm run start`
5. Instance type: **Free** (or a paid type).
6. Add the environment variables from the table below **before** the first deploy.
7. Under the advanced settings, set **Health Check Path** to `/api/health` and turn **Auto-Deploy** off.
8. Create the service.

### Environment variables

| Variable                        | Value on Render                                              | Set by `render.yaml` | Notes                                                                                            |
| ------------------------------- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------ |
| `NODE_VERSION`                  | `22`                                                         | Yes (`"22"`)         | See [Node.js version](#nodejs-version).                                                          |
| `NEXT_TELEMETRY_DISABLED`       | `1`                                                          | Yes                  | Turns off Next.js telemetry.                                                                     |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://<project-ref>.supabase.co`                          | Prompted             | Must be `https://`. Anything else is treated as "not configured".                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon / publishable key                                   | Prompted             | Public by design. `src/lib/env.ts` also accepts the name `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |
| `NEXT_PUBLIC_SITE_URL`          | The exact public origin, e.g. `https://foreman.onrender.com` | Prompted             | No trailing slash, no path. Used to build the links in sign-up and password-reset emails.        |
| `NEXT_PUBLIC_APP_URL`           | The same origin                                              | Prompted             | Only read when `NEXT_PUBLIC_SITE_URL` is unset. Set it to the same value.                        |

That is the complete list. In particular:

- **Do not set `SUPABASE_SERVICE_ROLE_KEY`.** Nothing in the application reads it.
- `AVATAR_PROVIDER_URL`, `EMAIL_PROVIDER_API_KEY` and `EMAIL_FROM_ADDRESS` appear in `.env.example` as unused
  placeholders. Leave them unset.
- The `E2E_*` variables are for running tests from your own machine, not for the service.

#### `NEXT_PUBLIC_*` values must be present at build time

Next.js replaces every `process.env.NEXT_PUBLIC_*` reference with its value while `next build` runs. The values
are then fixed in the build output, in server code as well as in the browser bundle. For Foreman this has three
concrete consequences:

- **A build without the Supabase values is an unconfigured app.** `getPublicEnv()` returns `null`, protected
  routes redirect to `/login`, the sign-in pages show a setup notice, and actions return `NOT_CONFIGURED`.
  Adding the variables afterwards and restarting does not fix it. The service must be rebuilt.
- **The Content-Security-Policy is fixed at build time too.** `next.config.ts` derives `connect-src` from
  `NEXT_PUBLIC_SUPABASE_URL` (the project's `https://` origin for REST and Auth and its `wss://` origin for
  Realtime), and the build writes the resulting headers into its route manifest. A build made without the
  variable allows `connect-src 'self'` only, and the browser will refuse to contact Supabase.
- **Changing any of these values later requires a rebuild.** On Render, change the variable and choose the
  save option that rebuilds and deploys, or trigger a manual deploy afterwards.

Render makes a service's environment variables available to both the build command and the running service, so
entering them once on the service is enough. Nothing with the `NEXT_PUBLIC_` prefix may ever hold a secret.

### Node.js version

`package.json` requires Node.js `>=22.12.0`. `render.yaml` sets `NODE_VERSION` to `22`, and Render gives the
`NODE_VERSION` environment variable precedence over `engines` in `package.json`. `22` is expected to resolve to
the newest 22.x release. Check the first lines of the build log for the version actually used; if it is older
than 22.12, set `NODE_VERSION` to a full version number (22.12.0 or newer in the 22 line) and redeploy.

Local development, CI (`node-version: 22`) and Render therefore all use Node 22.

### Port and host

Nothing needs configuring. `next start` listens on the port in the `PORT` environment variable (3000 if unset)
on all interfaces, which is what Render expects of a web service.

### Health check

`src/app/api/health/route.ts` answers `GET /api/health` with HTTP 200 and:

```json
{ "status": "ok", "supabaseConfigured": true, "time": "2026-10-08T12:00:00.000Z" }
```

- The route is excluded from the proxy matcher in `src/proxy.ts` and makes no call to Supabase, so it is cheap
  and does not depend on Supabase being reachable.
- The response has `Cache-Control: no-store` and contains no secrets.
- Render uses it to decide whether a new deploy is ready to receive traffic and whether a running instance is
  healthy.

It is a **liveness** check only. It returns 200 even when Supabase is not configured, so a green health check
does not mean the deployment works. Read the `supabaseConfigured` field yourself (first item of the
[checklist](#6-verify-the-deployment)). Because the public variables are inlined at build time, that field
reports what the build saw.

## 4. Confirm the URL

When the first deploy is live, read the service's URL at the top of its page in the Render dashboard.

- If it is exactly what you entered for `NEXT_PUBLIC_SITE_URL`, continue.
- If Render assigned a different subdomain, edit `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` on the
  service's **Environment** page and **rebuild**. Until you do, verification and password-reset emails will
  link to the wrong host.

## 5. Point Supabase Auth at the Render URL

Supabase only sends users back to URLs it has been told about. In the Supabase dashboard, under
**Authentication → URL Configuration**:

| Setting           | Value                                              |
| ----------------- | -------------------------------------------------- |
| **Site URL**      | `https://<your-service>.onrender.com`              |
| **Redirect URLs** | `https://<your-service>.onrender.com/auth/confirm` |

Rules:

- Use the exact origin: scheme `https`, the exact host, no trailing slash on the Site URL, no wildcards.
- The Site URL, `NEXT_PUBLIC_SITE_URL` on Render and the address people type must all be the same origin. If
  you add a custom domain later, change all three (and rebuild, for the Render variable).
- Keep `http://localhost:3000/auth/confirm` in the redirect list if you also develop locally against the same
  project.

Where these URLs come from in the code:

| Flow                 | Code                                          | URL the app asks Supabase to send people to |
| -------------------- | --------------------------------------------- | ------------------------------------------- |
| Sign-up confirmation | `registerAction` in `src/lib/auth/actions.ts` | `<site>/auth/confirm?next=/welcome`         |
| Resend confirmation  | `resendVerificationAction`                    | `<site>/auth/confirm?next=/welcome`         |
| Password reset       | `forgotPasswordAction`                        | `<site>/auth/confirm?next=/reset-password`  |

`<site>` is `NEXT_PUBLIC_SITE_URL` with any trailing slash removed (`getSiteUrl()` in `src/lib/env.ts`).

`src/app/auth/confirm/route.ts` is the single landing point. It accepts either link style Supabase can
produce, `?code=…` or `?token_hash=…&type=…`, consumes the token on the server and redirects to a clean URL:

- confirmation → `/verify-email?status=verified&next=/welcome`
- recovery → sets a short-lived httpOnly cookie, then `/reset-password`
- failure → `/verify-email?status=invalid` or `/reset-password?status=invalid`

The README recommends replacing two email templates so that links carry a token hash and go straight to your
own server (**Authentication → Email Templates**):

- Confirm signup: `{{ .SiteURL }}/verify-email?token_hash={{ .TokenHash }}&type=email`
- Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

With those templates the links are built from the **Site URL** alone, so the Site URL must be right. With the
default templates Supabase uses the redirect URL the app supplied, which is why `/auth/confirm` must be in the
redirect list.

Two things here are unverified and worth checking on the first real email:

- The app's redirect URLs include a query string (`?next=…`) while the allow-list entry does not. Whether
  Supabase accepts that match exactly as configured has not been tested. If the link in the email lands on the
  bare Site URL (the landing page, with a `code` in the address) instead of `/auth/confirm`, the redirect was
  not accepted: recheck the entry, or switch to the token-hash templates above, which do not depend on it.
- Email delivery itself. Supabase's built-in email service has a low sending quota; configure SMTP in the
  Supabase dashboard if you need more.

Also set, as the README describes: a short access-token lifetime (an hour or less) under the session/JWT
settings, and review the Auth rate limits.

## 6. Verify the deployment

Work through this list in order. Replace `$URL` with the service URL.

1. **Health and configuration.**

   ```bash
   curl -s $URL/api/health
   ```

   Expect `"status":"ok"` and `"supabaseConfigured":true`. If it is `false`, the build did not see the Supabase
   variables (or the URL is not `https://`): fix them and rebuild.

2. **Security headers.**

   ```bash
   curl -sI $URL/ | grep -i -E 'content-security-policy|strict-transport-security'
   ```

   `connect-src` must list `https://<project-ref>.supabase.co` and `wss://<project-ref>.supabase.co`.

3. **Public pages.** `$URL/` shows the landing page. `$URL/dashboard` redirects to `/login`.
4. **Registration and email verification.** Register a new account. The confirmation email arrives, its link
   points at your Render host, and following it ends on the "verified" state of `/verify-email`, which links on
   to `/welcome`.
5. **Login and a board.** Log in, create a board from the Project Roadmap template, add a sticky note. The
   status indicator in the top bar reaches "Saved". Reload: the note is still there.
6. **Realtime from the deployed domain.** This is the part no automated test has covered.
   - Open the same board in a second browser (or a private window) as a second, invited account.
   - The connection indicator beside the zoom controls reads "Connected" in both windows. If one stays on
     "Reconnecting", open the browser's developer tools: the Network panel should show a WebSocket to
     `wss://<project-ref>.supabase.co/realtime/v1/websocket` with status 101, and the Console should show no
     Content-Security-Policy violations.
   - Move a note in one window; it moves in the other without a reload.
   - Each window lists the other person under "Online now" and shows their cursor.
   - Post a comment in one window; it appears in the other.
   - Close one window; the other stops listing that person.
7. **Password reset.** Request a reset from `/forgot-password`. The link ends on `/reset-password`, and the new
   password works.
8. **Roles.** Invite the second account as Viewer on another board and confirm it cannot edit. Open a board URL
   as an account that is not a member and confirm you get "Board not found or access is unavailable."
9. **Logout.** Log out; `$URL/dashboard` and the board URL redirect to `/login`.
10. **Logs.** In the service's **Logs**, look for lines of the form `{"level":"error","scope":"…","code":"…"}`.
    These are written by `src/lib/log.ts` for unexpected failures.
11. **The end-to-end suite against the deployment.** From your machine, with two verified accounts:

    ```bash
    E2E_BASE_URL=$URL E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… \
    E2E_COLLABORATOR_EMAIL=… E2E_COLLABORATOR_PASSWORD=… npm run test:e2e
    ```

    Three tests must pass, not skip. See [Testing](testing.md#end-to-end-tests-testse2e).

The [demo script](demo-script.md) is a fuller manual walkthrough of the same ground.

When items 4 to 8 and 11 have passed against your deployment, the three "not run end to end" rows in the
README's status table are verified for your environment.

## Deploying changes

With auto-deploy off, a new version reaches Render in one of two ways:

- **GitHub Actions.** After CI succeeds for a push to `main`, `deploy.yml` calls the service's deploy hook.
  Setup: [GitHub Actions](github-actions.md).
- **By hand.** **Manual Deploy** on the service page in the Render dashboard.

Database changes are separate. A new migration must be applied to the Supabase project (CLI or SQL editor)
before or together with the application version that depends on it. Nothing in the deploy pipeline applies
migrations.

## Free plan caveats

These apply to Render's free web service instance type, as documented by Render at the time of writing. Check
Render's current documentation before depending on any of them.

- **Spin-down on idle.** A free web service that receives no inbound traffic for 15 minutes is spun down. The
  next request starts it again, which takes about a minute. The first page load after a quiet period will be
  slow.
- **Monthly instance hours.** Free web services draw on a monthly allowance of instance hours per workspace
  (750 at the time of writing). A service that is spun down does not consume them.
- **No persistent disk.** Foreman does not need one: it writes nothing to the local filesystem at runtime. All
  state is in Supabase.
- **Small instance.** The free instance has a fraction of a CPU and 512 MB of memory. Whether `next build` and
  the running server are comfortable within that has not been tested.

What spin-down means for Foreman specifically, reasoning from the architecture rather than from observation:
canvas edits, comments and realtime traffic go from the browser directly to Supabase, not through Render. A
board that is already open should therefore keep working while the Render service is asleep, but that traffic
does not count as inbound traffic to Render and will not keep the service awake. Navigation, Server Actions
(for example on the dashboard and settings pages) and page reloads will wait for the service to start.

Supabase's own plan limits apply separately. The one the README calls out is the low default email quota.

## Rollback

### Application

- **Render dashboard.** On the service's **Deploys** page, choose **Rollback** on an earlier successful deploy.
  Render redeploys that deploy's existing build artifact without rebuilding. Two consequences:
  - the rolled-back version has the `NEXT_PUBLIC_*` values it was built with, whatever the Environment page
    says now;
  - on the free plan Render keeps only a small number of recent deploys available for rollback (the two most
    recent previous ones, per Render's free-plan documentation).
- **Git.** Revert the offending commit on `main` and push. CI runs, and on success `deploy.yml` triggers a deploy
  of the revert. This is slower but leaves `main` matching what is deployed.

After a dashboard rollback, `main` still contains the bad commit. The next successful CI run on `main` will
deploy it again through the deploy hook, so follow a dashboard rollback with a revert, or temporarily remove
the `RENDER_DEPLOY_HOOK_URL` secret (the deploy job then does nothing; see
[GitHub Actions](github-actions.md#when-the-secret-is-absent)).

### Database

Migrations are forward-only SQL files; there are no down migrations. Rolling the application back does not
undo a migration. If a migration has to be reversed, write a new migration that does so, and apply it. Take a
database backup before applying migrations to a project that holds real data.

### Configuration

If the fault is a wrong environment value, correct it on the **Environment** page and rebuild. A rollback will
not help, because the previous build may contain the same wrong value.

## Troubleshooting

| Symptom                                                                   | Likely cause                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health` shows `"supabaseConfigured":false`                          | Supabase variables missing at build time, misspelled, or the URL is not `https://`. Fix and rebuild.                                                                                                                                                                                                                                                                                                           |
| Sign-in pages show a "not connected" setup notice                         | Same as above.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Console shows CSP errors for `supabase.co`; board stuck on "Reconnecting" | The build ran without `NEXT_PUBLIC_SUPABASE_URL`, or with a different project's URL. Rebuild.                                                                                                                                                                                                                                                                                                                  |
| Email link opens `localhost:3000`                                         | `NEXT_PUBLIC_SITE_URL` was not set at build time (the code falls back to `http://localhost:3000`), or the Supabase Site URL was left at its default.                                                                                                                                                                                                                                                           |
| Email link opens the landing page with `?code=` in the address            | The redirect to `/auth/confirm` was not accepted. Check the Redirect URLs entry.                                                                                                                                                                                                                                                                                                                               |
| "This reset link is invalid or has expired" straight after clicking       | Link already used (some mail scanners open links), expired, or opened in a different browser from a PKCE-style link. Request a new one.                                                                                                                                                                                                                                                                        |
| The browser reports too many redirects between `/login` and `/dashboard`  | From reading the code, not from observation: the session token is valid but `getCurrentProfile()` returned nothing (profile row missing, account not `ACTIVE`, or the profile query failed; look for `dal.profile` in the logs). The page redirects to `/login` and the proxy redirects signed-in users away from `/login`. Check that all migrations were applied; clearing the site's cookies ends the loop. |
| First request after a while takes a long time                             | Free-plan spin-down.                                                                                                                                                                                                                                                                                                                                                                                           |
