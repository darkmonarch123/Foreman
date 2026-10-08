# Demo script

A presenter's script for showing Foreman end to end with two genuinely registered accounts: **Account A**, who
owns the board, and **Account B**, who collaborates on it. Every label, tab name and URL below is taken from the
application's code.

## Read this first

**This script has not yet been run against a live Supabase project.** The repository was built and tested without
one (see the table at the top of the [README](../README.md)). The board steps (5 and 8 to 12) match what the
browser tests exercise against an in-memory backend; the account steps (1, 2, 7 and 13) and everything that
depends on real Supabase Auth and Realtime are implemented but unobserved.

So treat your first run as a rehearsal and as the verification itself. Where a step says "Expected", that is what
the code should do. If something differs, note it; [What can go wrong](#what-can-go-wrong) lists the likely
causes.

Nothing in the demo is staged. There are no seeded users, no sample comments, no simulated cursors. If a second
person does not appear online, it is because they are not connected.

## Prerequisites

### A configured Supabase project

Follow "Supabase setup" in the [README](../README.md) and [Supabase schema and policies](supabase-schema.md). In
short:

- all migrations in `supabase/migrations` applied, in filename order;
- email sign-in enabled with **Confirm email** on and a minimum password length of 10;
- **Site URL** set to the exact origin you will present from, and `<app-url>/auth/confirm` added as a redirect
  URL;
- the two email templates from the README installed if you can (recommended; it makes verification links work
  from any browser window).

### The app running

- Locally: `.env.local` filled in from `.env.example`, then `npm run dev`, and present from
  `http://localhost:3000`.
- Or deployed, following [Deployment on Render](deployment-render.md).

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` must be set before the
app is built or started. Open `<app-url>/api/health` and check that it reports `"supabaseConfigured": true`.

### Two real inboxes

You need two email addresses you can read during the demo, written here as `<account-a-email>` and
`<account-b-email>`. Choose a password for each that has at least 10 characters with a letter and a number. Do
not reuse real passwords on a projector.

Supabase's built-in email service allows only a small number of emails per hour. Two sign-ups use two of them,
and every "resend" uses another. If you expect to rehearse more than once, configure SMTP in the Supabase
dashboard first.

### Two separate browser sessions

Account A and Account B must not share cookies.

- **Window A:** a normal browser window.
- **Window B:** a private/incognito window, or a different browser.

Two normal windows of the same browser share one session, and so do two incognito windows of the same browser.

### Placeholders used below

| Placeholder         | Meaning                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `<app-url>`         | The origin you present from, such as `http://localhost:3000`         |
| `<account-a-email>` | Account A's email address                                            |
| `<account-b-email>` | Account B's email address                                            |
| `<board-url>`       | The address of the board once created: `<app-url>/boards/<board-id>` |

### To save time on the day

Registration and verification depend on email delivery. You can do steps 1, 2 and the registration half of
step 7 before the audience arrives, then start the live part by logging in. If you do, say so; the accounts are
still real.

In each window, the first page shows a cookie banner in the bottom-left corner. Click **Reject optional
cookies** (or **Accept optional cookies**; nothing optional exists either way). Do this early: on the board the
banner sits over the connection indicator.

## The demo

### Step 1: Register Account A and try to log in

In Window A:

1. Open `<app-url>/`. The landing page heading is "Your space for notes, plans, and big ideas".
2. Click **Create your free workspace** (or **Create account** in the navigation bar). You arrive at
   `<app-url>/register`.
3. Fill in **First name**, **Last name**, **Username** (3 to 24 lowercase letters, numbers or underscores),
   **Email** (`<account-a-email>`), **Password** and **Confirm password**. Under **Initial avatar** choose
   **Female** or **Male**.
4. Click **Create account**.

**Expected:** you land on `<app-url>/verify-email?sent=1` with the heading "Check your inbox" and the text "If the
details you entered can be used for a new account, we've sent a verification link. Open it on this device to
finish setting up."

Optionally, show that the account cannot be used yet. Open `<app-url>/login`, enter the **Email** and
**Password** and click **Log in**.

**Expected:** an error reading "Verify your email address to use this feature." with a link, **Resend the
verification email**.

**Say:** "This is a real Supabase Auth account. The password went straight to Supabase; Foreman's own code never
stores or logs it. The confirmation screen is worded the same whether or not the address was already registered,
so it cannot be used to find out who has an account. And until the address is verified, the account can't log
in."

### Step 2: Verify the email and arrive signed in

1. Open the inbox for `<account-a-email>` and find the confirmation email from Supabase Auth.
2. Open the link **in Window A**. If your mail client would open it somewhere else, copy the link address and
   paste it into Window A's address bar.

**Expected:** a page headed "Email verified" with "Your address is confirmed. You can now create boards and
collaborate." and a **Continue** button.

3. Click **Continue**.

**Expected:** `<app-url>/welcome`, headed "Welcome to Foreman, <first name>." with the question "How would you
like to begin?" You are signed in. If you are sent to the login page instead, log in with **Email**,
**Password** and **Log in**; you will be returned to the welcome page.

**Say:** "Verifying the link is what unlocks everything else. Creating boards, editing, commenting, inviting and
joining all check for a verified email inside the database, not just in the interface. The session lives in
cookies; nothing long-lived is kept in local storage."

### Step 3: Choose the Project Roadmap template

1. On the welcome page click **Use a template**. You arrive at `<app-url>/templates`.
2. Find the **Project Roadmap** card (tagged "Planning" and "Featured"). Optionally click **Preview** to show the
   layout, then **Close**.
3. Click **Use this template**.

**Expected:** `<app-url>/boards/new?template=project-roadmap`, headed "Create a board". On the right, under
"Starting point", is a preview of Project Roadmap with its description.

**Say:** "There are six starter templates, stored in the database. Everything on a template is sample content
that becomes ordinary, editable board items."

### Step 4: Create "Foreman Launch Plan"

1. In **Board name** type `Foreman Launch Plan`.
2. Leave **Who can access this board** on **Private**. The other options are **Invite only**, **Anyone with the
   link can view** and **Anyone with the link can request access**.
3. Click **Create board**.

**Expected:** the board opens at `<app-url>/boards/<board-id>`. Copy this address; it is `<board-url>` from here
on. You should see:

- the title "Project Roadmap" and three columns, **Plan**, **Build** and **Test**, with example notes;
- in the top bar: the board name, an **Owner** badge, the status **Saved**, and the **Share** and **Export**
  buttons;
- bottom left: zoom controls and a **Connected** indicator;
- on the right, the "Board panel" with tabs **People**, **Activity**, **Comments** and **Outline**. People shows
  "Online now (1)" and "No one else is on the board right now."

**Say:** "The board was created by a database function that made me its owner and copied the template's items
onto it. From here on, every read and every change is authorised in the database against my membership of this
board."

### Step 5: Add a sticky note and move it into the Build column

1. Press **N** (or click **Sticky note** in the tool rail on the left).
2. Click an empty area of the canvas, for example below the Plan column.

   **Expected:** a yellow note appears with a text cursor in it.

3. Type `Ship the launch checklist`, then press **Ctrl+Enter** (**Cmd+Enter** on macOS) or click somewhere else
   on the canvas.

   **Expected:** the status in the top bar goes to **Saving** and back to **Saved**. The tool returns to
   **Select**.

4. Drag the note into the **Build** column (the middle one) and drop it below "Example: first deliverable".

   **Expected:** the note stays where you dropped it and the status returns to **Saved**.

**Say:** "The note appeared instantly because edits are applied optimistically, then confirmed by the server.
'Saved' means the database accepted the operation and gave it a sequence number. If I were a viewer, the same
request would be refused by the database, whatever my browser sent."

If you would rather not use the mouse for the move: open the **Outline** tab, select "Sticky note: Ship the
launch checklist", and press **Move right** and **Move up** repeatedly (each press moves the note 20 units; the
columns are 340 apart). See [Accessibility](accessibility.md).

### Step 6: Invite Account B as Editor

1. Click **Share** in the top bar. A dialog titled `Share “Foreman Launch Plan”` opens on its **Invite** tab. The
   other tabs are **Members**, **Link and code** and **Requests**.
2. In **Email address** type `<account-b-email>`. Leave **Role** on **Editor**.
3. Click **Invite**.

**Expected:** a green box: "Invitation created for `<account-b-email>`. If they have a Foreman account with that
address, it is waiting under their notifications. You can also send them this link. It is shown only once."
Below it is an **Invitation link** field with a **Copy** button and the note "Works only for that email address
and expires in 7 days." Under "Invitations" the address is listed as **Pending**.

4. Click **Copy** if you want to use the link in step 7. Close the dialog with **Close** or the Escape key.

**How the invitation is actually delivered.** Foreman does not send an invitation email; no email provider is
integrated. There are two real delivery routes, and you can show either:

- **In the app.** Anyone signed in with a verified account for exactly that address sees the invitation under
  the bell icon on their dashboard. It works even if they register after the invitation was created.
- **By link.** The owner is shown `<app-url>/invitations/accept?token=…` once and passes it on however they
  like. The link only works for an account whose verified email is the invited address.

**Say:** "I've invited by email address and chosen the role. No email was sent; that is deliberately not built
yet. The invitation token is stored only as a hash, which is why the link is shown once. And the link is useless
to anyone else: accepting requires being signed in with that exact verified address."

The response would have been identical if `<account-b-email>` had no account at all. Inviting also moved the
board's sharing mode from Private to **Invite only**; you can show that on the **Link and code** tab.

### Step 7: Open Account B in a second window

In Window B (private/incognito, or a second browser):

1. If Account B is not registered yet: open `<app-url>/register`, register with `<account-b-email>` as in step 1,
   then verify as in step 2, **pasting the verification link into Window B**. Click **Continue**, then **Skip to
   dashboard**.

   If Account B was registered earlier: open `<app-url>/login`, enter **Email** and **Password**, and click
   **Log in**. You arrive at `<app-url>/dashboard`.

2. Click the bell in the top bar. Its label reads "Notifications, 1 waiting".

   **Expected:** an entry reading "<Account A's name> invited you to Foreman Launch Plan as an editor." with
   **Accept** and **Decline** buttons.

3. Click **Accept**.

**Expected:** a confirmation "You joined Foreman Launch Plan." and the board opens in Window B with an
**Editor** badge. Account B sees the template, and the sticky note in the Build column.

Alternative for step 2 and 3: paste the invitation link from step 6 into Window B. The page is headed "You've
been invited to a board"; click **Accept invitation**.

**Say:** "This is a second real account in a separate browser session. It became a member only because the
owner invited that address and the person holding it accepted. Before accepting, this same address got 'Board
not found or access is unavailable' for the board's URL, the same answer as for a board that doesn't exist."

You can show that last point before clicking Accept: paste `<board-url>` into Window B first.

### Step 8: Show real presence and cursors

Arrange the two windows side by side.

1. In Window A, look at the **People** tab.

   **Expected:** "Online now (2)" listing both accounts, each with a role badge, and two avatars in the top bar.
   The line "No one else is on the board right now." is gone.

2. In Window B, move the mouse over the canvas.

   **Expected:** in Window A, a coloured cursor follows it, labelled with Account B's first name. Move the mouse
   in Window A and the reverse happens in Window B.

3. In Window B, press **N**, click the canvas, type `Added by the collaborator` and press **Ctrl+Enter**.

   **Expected:** the note appears in Window A without a reload.

4. Optionally close Window B's tab.

   **Expected:** shortly afterwards Window A shows "Online now (1)" and Account B under "Offline". Reopen
   `<board-url>` in Window B before continuing.

A cursor that stops moving disappears after about eight seconds. That is intended; move the mouse again and it
returns.

**Say:** "Presence and cursors travel over private Supabase Realtime channels that only members of this board
can join. Cursor positions are never stored. The note took a different path: it was written to the database
first, and the database itself announced it to the channel, so a client can't inject a change that wasn't
saved."

Be straightforward about the limit if asked: presence and cursor identity is reported by each client. Only board
members can take part and only members are shown, but one member could make another appear online. Board content
cannot be forged that way. See [Realtime](realtime.md).

### Step 9: Add a real comment

1. In Window A, open the **Comments** tab.
2. In **Add a comment** type `Looks ready for review.` and click **Post comment**.

**Expected:** the comment appears in the list with Account A's name and "just now". In Window B, the Comments tab
shows a count, and opening it shows the same comment.

To attach a comment to an item instead: select the sticky note, then click **Comment on this item** in the
toolbar that appears above the canvas. A chip reading "On Sticky note: Ship the launch checklist" appears above
the comment box.

**Say:** "The author is taken from the session by the database. There is nowhere in the request to say who you
are. The text is stored as written and always displayed as text, never interpreted as HTML."

### Step 10: Show the real activity event

1. In Window A, open the **Activity** tab.

**Expected:** a list, newest first, with entries such as:

- "<Account A> commented"
- "<Account B> added a sticky note"
- "<Account B> joined as an editor"
- "<Account A> invited someone as an editor"
- "<Account A> moved a sticky note"
- "<Account A> edited a sticky note"
- "<Account A> added a sticky note"
- "<Account A> started from the Project Roadmap template"
- "<Account A> created this board"

Repeated moves or edits of the same item within a minute are folded into one line, shown as "(2 times)".

**Say:** "Nobody typed these. Each entry is written by the same database function that performed the action, in
the same transaction, with the actor taken from the session. The browser has no write access to this table."

### Step 11: Export the board as a PNG

1. In Window A, click **Export** in the top bar. A dialog titled "Export as PNG" opens.
2. Leave **Whole board** selected (the other option is **Current view**) and click **Export PNG**.

**Expected:** a file named `foreman-launch-plan-<date>.png` downloads, and the dialog shows "Saved as
foreman-launch-plan-<date>.png. Check your downloads."

3. Click **Done**, then open the file.

**Expected:** the canvas content only, on a plain background: no side panel, no member names, no comments, no
cursors.

4. Look at the **Activity** tab again.

**Expected:** a new top entry, "<Account A> exported the board as a PNG".

**Say:** "The image is drawn in my browser from the board's data, not captured from the screen, which is why
nothing from the interface or from other people's cursors can leak into it."

### Step 12: Reload to prove persistence

1. Reload Window A.

**Expected:** after a brief loading state the board returns exactly as it was: the note in the Build column, the
collaborator's note, the comment under **Comments**, the history under **Activity**.

2. Optionally click the back arrow (**Back to dashboard**).

**Expected:** `<app-url>/dashboard`, with a "Foreman Launch Plan" card showing an **Owner** badge. In Window B
the same board is listed under "Shared with me" with an **Editor** badge.

**Say:** "Nothing was kept in the browser. The page was rebuilt from the database: the latest snapshot plus the
operations after it."

### Step 13: Log out and show that protected routes redirect

In Window A:

1. Open the account menu: the avatar at the right of the board's top bar, or the name at the bottom of the
   dashboard sidebar. Choose **Log out**.

   **Expected:** `<app-url>/login`.

2. Paste `<board-url>` into the address bar.

   **Expected:** a redirect to `<app-url>/login?next=%2Fboards%2F<board-id>`. The board is not shown.

3. Open `<app-url>/dashboard`, then `<app-url>/settings`.

   **Expected:** the login page each time.

**Say:** "Signed out, every protected route sends me to the login page. That redirect is only the first of three
checks: each page checks the session again on the server, and the database refuses the queries regardless. The
second window is still signed in as the collaborator, because it is a separate session."

If you log in again from the redirected page, you are returned to the board, not to an arbitrary address: the
`next` value is accepted only if it is a path on this site.

## Optional extras

### The Viewer role is read-only

1. Window A (signed in as Account A, on the board): **Share**, **Members** tab. Next to Account B, change the
   role select from **Editor** to **Viewer**.
2. Window B.

   **Expected:** without a reload (this relies on Realtime; reload if it does not update), the badge changes to
   **Viewer** and the status reads **View only**. The editing tools in the
   rail are dimmed. Pressing **N** and clicking, dragging a note, pressing **Delete** or double-clicking an item
   all do nothing. The **Comments** tab shows "Viewers can read comments on this board but can't add them."

3. To let viewers comment: Window A, **Share**, **Link and code** tab, turn on **Viewers can comment**.

**Say:** "The interface hides the tools, but that is a courtesy. The rule is in the database, and it is tested
there."

Set Account B back to **Editor** afterwards if you are continuing.

### Offline edit, then reconnect

1. In Window A, open the browser's developer tools and switch the network to offline (in Chrome: Network tab,
   throttling menu, **Offline**).

   **Expected:** the status reads **Offline**, in the top bar and at the bottom left.

2. Add or move a note.

   **Expected:** the change shows immediately, and the top bar counts it ("1 unsaved change"). Window B does not
   see it yet.

3. Switch the network back on.

   **Expected:** the status passes through **Saving** to **Saved**, and the change appears in Window B.

**Say:** "Unsent edits are queued in this browser and re-sent on reconnect. Each has its own id, so if a retry
arrives twice the server applies it once."

If you try to close the tab while changes are unsent, the browser asks for confirmation.

### Join by collaboration code

A code only does something when the owner has chosen one of the link modes, and it never gives more than view
access.

1. Window A: **Share**, **Link and code** tab. Under **Sharing mode** choose **Anyone with the link can view**.
   Under **Collaboration code**, copy the value in the **Code** field (it looks like `F-1WE-23XX`).
2. Account B is already a member, so first make it leave: in Window B, go to the dashboard, open the three-dot menu
   on the "Foreman Launch Plan" card ("Actions for Foreman Launch Plan"), choose **Leave board** and confirm
   with **Leave board**. (Or use a third verified account.)
3. Window B: open `<app-url>/join`. In **Collaboration code** enter the code and click **Join board**.

   **Expected:** "You joined as a viewer", with an **Open board** button.

Variations worth showing:

| Do this                                                                                 | Expected                                                                                                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter a wrong code, such as `F-ZZZ-0000`                                                | "Board not found or access is unavailable."                                                                                                    |
| Set the sharing mode back to **Invite only** and try the real code from a non-member    | The same message. The board is not confirmed to exist                                                                                          |
| Choose **Anyone with the link can request access**, then join by code from a non-member | "Request submitted". Account A sees it under the bell and in **Share**, **Requests**, with **Approve as viewer**, **As editor** and **Reject** |
| Enter the code while already a member                                                   | "You're already on this board"                                                                                                                 |

The owner cannot switch back to **Private** while other people are on the board; the message is "Remove the
other members before making this board private."

## What can go wrong

| Symptom                                                                                                                                                 | Likely cause                                                                                                                                               | Fix                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A yellow notice: "Foreman isn't connected to its database yet."                                                                                         | The Supabase URL or anon key is not set for this build                                                                                                     | Set the variables, then rebuild or restart. Check `<app-url>/api/health`                                                                                                                               |
| Logging in works, but opening a board shows "Something went wrong", or the browser console shows requests blocked by the Content Security Policy        | The public Supabase variables were not set when the app was built. They are compiled into the browser bundle and into the policy's list of allowed origins | Set them, then rebuild (or restart `npm run dev`)                                                                                                                                                      |
| Registering or resending shows "You're doing that too often. Wait a moment and try again."                                                              | Supabase Auth's email or request rate limit                                                                                                                | Wait and retry. Configure SMTP for more headroom. Register both accounts ahead of time                                                                                                                 |
| No verification email arrives                                                                                                                           | Delivery delay, spam folder, the hourly email limit, or the address is already registered (the screen is the same on purpose)                              | Check spam. If the address may already be registered, try logging in, or use **Forgot your password?**                                                                                                 |
| The verification link shows "That link didn't work"                                                                                                     | It was opened in a different browser or profile from the one that registered, it was already used, or it expired                                           | Enter the address under that message and click **Resend verification email**, then open the new link in the right window. Installing the README's email templates removes the same-browser requirement |
| After opening Account B's link, Window A is signed in as Account B                                                                                      | The link was opened in Window A. Verifying signs that browser in                                                                                           | Log out in Window A and log in again as Account A. Always paste Account B's links into Window B                                                                                                        |
| The email link goes to the wrong host                                                                                                                   | The Site URL in Supabase or `NEXT_PUBLIC_SITE_URL` does not match where you are presenting from, or the redirect URL is not allowed                        | Make all three agree on `<app-url>` and add `<app-url>/auth/confirm` to the redirect URLs                                                                                                              |
| Login shows "Verify your email address to use this feature."                                                                                            | The account has not been verified                                                                                                                          | Finish step 2, or use **Resend the verification email**                                                                                                                                                |
| Login shows "That email and password don't match. Check them and try again."                                                                            | Wrong email or password. The message is the same for an unknown address                                                                                    | Re-enter them. Use **Forgot your password?** if needed                                                                                                                                                 |
| A banner "Verify your email address to create boards and collaborate.", or creating a board fails with "Verify your email address to use this feature." | An unverified account is signed in, which should only happen if Confirm email is off in Supabase                                                           | Verify the address; turn Confirm email on                                                                                                                                                              |
| Both windows show the same account                                                                                                                      | They share cookies                                                                                                                                         | Use a private window or another browser for Account B                                                                                                                                                  |
| Account B's bell shows nothing                                                                                                                          | The dashboard was loaded before the invitation existed; or Account B's email differs from the invited address; or it is unverified                         | Reload the page. Compare the addresses. Otherwise use the invitation link, or invite again                                                                                                             |
| "This invitation can't be used"                                                                                                                         | Signed in as a different account, or the invitation expired (7 days), was revoked, was replaced by a resend, or was already accepted                       | Sign in as the invited address. If needed, Account A opens **Share**, **Invite** and clicks **Resend** for a fresh link                                                                                |
| Account B gets "Board not found or access is unavailable." on `<board-url>`                                                                             | Not a member yet                                                                                                                                           | Accept the invitation first                                                                                                                                                                            |
| The indicator stays on **Reconnecting**; no presence, no cursors, other people's edits do not appear live                                               | Realtime is not connecting: the realtime migration was not applied, Realtime is not available for the project, or the network blocks WebSockets            | Confirm `20261008000700_realtime.sql` was applied; check the browser console and the project's Realtime settings; try another network. See [Realtime](realtime.md)                                     |
| A cursor vanishes                                                                                                                                       | No movement for about eight seconds, or the other tab is in the background                                                                                 | Move the mouse over the canvas in the other window                                                                                                                                                     |
| A red banner starting "Sync failed."                                                                                                                    | The session expired, access was removed, or the database refused the change                                                                                | Use **Log in again** or **Try again** in the banner. Unsent changes are kept until you choose **Discard unsaved changes**                                                                              |
| The Export PNG button is disabled, with "This board is empty, so there is nothing to export yet."                                                       | Whole-board export on an empty board                                                                                                                       | Add something first                                                                                                                                                                                    |
| Export shows "Saved as …" but no file appears                                                                                                           | The browser blocked or redirected the download                                                                                                             | Check the browser's download settings and try **Export again**                                                                                                                                         |
| Joining by code shows "Too many attempts"                                                                                                               | More than ten code or link lookups in ten minutes from one account                                                                                         | Wait ten minutes                                                                                                                                                                                       |
| The connection indicator is hidden                                                                                                                      | The cookie banner is covering it                                                                                                                           | Dismiss the banner                                                                                                                                                                                     |

## After the demo

- The two accounts and the board are real data in your Supabase project. To remove the board: in Window A open
  the board, click the gear (**Board settings**), open the **Danger zone** tab, click **Delete this board**, type
  the board's name and click **Delete board**. You land in **Trash**; open the card's menu and choose **Delete
  forever**.
- To remove an account: **Settings**, **Privacy and data**, **Delete my account**. This deactivates it; final
  removal is the operator runbook in [Security](security.md#account-purge-runbook).
- If the run matched this script, record that: it is the first end-to-end confirmation against real Supabase
  Auth and Realtime. `npm run test:e2e` automates most of steps 3 to 13 with two pre-verified accounts; see
  [Testing](testing.md).
