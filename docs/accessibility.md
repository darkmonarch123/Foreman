# Accessibility

This document describes what Foreman does for keyboard, screen-reader, low-vision and motion-sensitive users,
what the automated tests check, and where it falls short. It is written from the code as it stands.

**Foreman does not claim conformance with WCAG or any other standard.** No formal audit has been carried out and
nothing here has been tested with a screen reader or other assistive technology. Several real barriers are listed
under [Known limitations](#known-limitations); read that section before relying on anything above it.

## Summary

| Area                                 | State                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Forms, dialogs, menus, tabs          | Built on native elements and the usual ARIA patterns; covered by component tests and nine browser tests |
| Board canvas                         | An SVG drawing surface that is **not** navigable by keyboard or screen reader                           |
| Alternative to the canvas            | The Board Outline: a list of every item with keyboard-operable actions                                  |
| Creating new items without a pointer | **Not possible**, apart from duplicating an existing item                                               |
| Colour contrast                      | Ratios computed from the design tokens (below); not measured in a rendered page                         |
| Assistive-technology testing         | None                                                                                                    |
| Browsers tested                      | Chromium only, and only the board, against an in-memory test backend                                    |

## Semantics and labelling

### Page structure

- `<html lang="en">`. The interface is English only.
- A "Skip to content" link is the first focusable element on every page (`src/app/layout.tsx`). It targets
  `#main`, and every page renders a `<main id="main">`.
- Pages set a title through the Next.js metadata template `"<page> · Foreman"`. The board page's title is the
  fixed word "Board", not the board's name.
- The signed-in shell has two `<nav aria-label="Workspace">` regions (a sidebar on wide screens, a horizontal bar
  below 1024 px; only one is displayed at a time), the active link carries `aria-current="page"`, and the search
  boxes are `role="search"` forms with visually hidden labels.
- The board page has a `<header>` (top bar), `<main aria-label="Board: <title>">` and
  `<aside aria-label="Collaboration panel">`. Groups of controls are labelled: `role="toolbar"` "Canvas tools",
  `role="group"` "History" and "Zoom", and a `role="toolbar"` named after the selected item ("Sticky note
  options").
- Headings: every page has an `<h1>` with one exception. On the board page the title is an `<h1>` for editors and
  viewers, but for the owner it is a button ("Board name: …", which opens rename), so **the owner's board page
  has no `<h1>`**.

### Controls

- **Form fields** (`src/components/ui/field.tsx`) have a visible `<label>` tied to the control. Hints and errors
  are linked with `aria-describedby`; an invalid field gets `aria-invalid`, and its error is a `role="alert"`
  paragraph directly under the field. Where a label is visually hidden (the text-size and member-role selects) it
  is supplied as `aria-label`.
- **Groups of radio buttons** are `<fieldset>`s with a `<legend>`: "Initial avatar", "Who can access this board",
  "Sharing mode", "What to include".
- **Switches** are buttons with `role="switch"`, `aria-checked`, and `aria-labelledby` / `aria-describedby`
  pointing at their visible text.
- **Icon-only buttons** go through `IconButton`, whose `label` prop is required and becomes both `aria-label` and
  `title`. Icons themselves are `aria-hidden`.
- **Tool buttons** expose `aria-pressed` for the active tool and `aria-keyshortcuts` for their key. For viewers,
  editing tools are `aria-disabled` and stay focusable; the "(view only)" explanation is in the tooltip, not in
  the accessible name.
- **Buttons that are busy** are disabled, set `aria-busy`, and swap their text for a loading label ("Creating
  board", "Posting").
- **Password fields** have a show/hide button with `aria-pressed` and a label that changes between "Show
  password" and "Hide password".
- **Auth forms** use `autocomplete` values (`email`, `current-password`, `new-password`, `given-name`,
  `family-name`, `username`), disable native validation bubbles in favour of the inline errors above, and show
  form-level failures in a `role="alert"` notice. React Hook Form's default of moving focus to the first invalid
  field on submit is left on.

### Images and non-text content

- **Avatars** are `<img>` elements. Next to a written name they are decorative (`alt=""`); on their own the
  `alt` is the person's name. A presence dot carries visually hidden text, "Online" or "Offline". A stack of
  avatars is a group labelled with the names, including "and N more".
- **Template previews** are SVGs with `role="img"` and a label such as "Preview of the Project Roadmap template".
  The label names the template; it does not describe the layout. Dashboard thumbnails are decorative and hidden.
- **The wordmark** is `role="img"` with the name "Foreman", so it is not read letter by letter.
- **Relative times** ("5 minutes ago") are `<time>` elements with a machine-readable `datetime` and the exact
  time in `title`.
- **Loading skeletons** are hidden from assistive technology and wrapped in a `role="status"` region that
  carries one text label ("Loading your boards").

### Composite widgets

| Widget                 | Pattern                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Modal (`ui/modal.tsx`) | `role="dialog"`, `aria-modal="true"`, labelled by its title and described by its description                                              |
| Menus (`ui/menu.tsx`)  | `role="menu"` with `role="menuitem"` buttons; the trigger has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`                 |
| Tabs (`ui/tabs.tsx`)   | `tablist` / `tab` / `tabpanel`; only the selected tab is in the Tab order; selection follows focus                                        |
| Command palette        | A dialog containing a `combobox` input that controls a `listbox`, using `aria-activedescendant`                                           |
| Notifications          | A button with `aria-expanded` and a count in its name ("Notifications, 2 waiting") that reveals a labelled `region`                       |
| Tooltips               | `role="tooltip"`, shown on hover and on focus, linked with `aria-describedby`; they repeat or extend the control's name, never replace it |

### The canvas

The drawing surface is an `<svg role="group">` labelled "Board canvas. The Outline panel lists every item for
keyboard and screen-reader use." The items inside it have no roles, names or focus. Their text is present in the
DOM, so a screen reader may read it in document order, but without any indication of what kind of item it
belongs to or where it sits. Treat the canvas as a visual surface and the [Board Outline](#the-board-outline) as
the accessible route to its content.

## Keyboard support

### Shortcuts on the board

Every row was checked against the handlers in `board-workspace.tsx`, `canvas-stage.tsx` and
`src/lib/board/tools.ts`. "Mod" is Ctrl on Windows and Linux and Cmd on macOS (either is accepted everywhere).

| Keys                    | Action                                                               | Notes                                                                                |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `V`                     | Select tool                                                          |                                                                                      |
| `H`                     | Hand (pan) tool                                                      |                                                                                      |
| `P`                     | Pen tool                                                             | Editors and owners                                                                   |
| `E`                     | Eraser tool                                                          | Editors and owners                                                                   |
| `N`                     | Sticky note tool                                                     | Editors and owners                                                                   |
| `T`                     | Text tool                                                            | Editors and owners                                                                   |
| `R`                     | Rectangle tool                                                       | Editors and owners                                                                   |
| `O`                     | Circle tool                                                          | Editors and owners                                                                   |
| `A`                     | Arrow tool                                                           | Editors and owners                                                                   |
| `C`                     | Comment tool                                                         |                                                                                      |
| `Delete` or `Backspace` | Delete the selected item                                             | Editors and owners                                                                   |
| `Enter`                 | Edit the selected item's text                                        | Only when focus is not on a button, link, tab or menu item                           |
| Arrow keys              | Move the selected item by 1 unit                                     | Not while focus is inside a tab list, menu or list box                               |
| `Shift` + arrow keys    | Move the selected item by 10 units                                   |                                                                                      |
| Mod + `Z`               | Undo your last change                                                |                                                                                      |
| Mod + `Shift` + `Z`     | Redo                                                                 |                                                                                      |
| Mod + `Y`               | Redo                                                                 | Works, but is not listed in the in-app shortcut dialog                               |
| Mod + `D`               | Duplicate the selected item                                          |                                                                                      |
| `Esc`                   | Return to the Select tool; if already on Select, clear the selection |                                                                                      |
| Mod + `+` or Mod + `=`  | Zoom the canvas in                                                   | Replaces the browser's own zoom shortcut on this page; see Known limitations         |
| Mod + `-`               | Zoom the canvas out                                                  | As above                                                                             |
| Mod + `0`               | Zoom to fit the board                                                | As above                                                                             |
| Mod + scroll            | Zoom at the pointer                                                  | Plain scrolling pans                                                                 |
| `Space` + drag          | Pan                                                                  | Needs a pointer. Space is left alone when a button, link, tab or menu item has focus |
| Mod + `K`               | Open the command palette                                             | Also works while typing in the comment box and other ordinary fields                 |
| `?`                     | Open the keyboard-shortcut list                                      |                                                                                      |

The letters are matched without regard to case. The tool only arms the canvas: placing a note, shape, arrow or
stroke still takes a click or drag (see Known limitations).

Inside specific controls:

| Where                              | Keys                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| In-place text editor on the canvas | Mod + `Enter` or moving focus away saves; `Esc` cancels and discards the edit                              |
| "Add a comment" box                | Mod + `Enter` posts                                                                                        |
| Board-name field in the top bar    | `Enter` or moving focus away saves; `Esc` cancels                                                          |
| Dialogs                            | `Tab` / `Shift` + `Tab` cycle inside; `Esc` closes                                                         |
| Menus                              | Up/Down move; `Home` / `End` jump; typing a letter jumps to the first matching item; `Esc` or `Tab` closes |
| Tabs                               | Left/Right move and select; `Home` / `End` jump                                                            |
| Command palette                    | Up/Down move through results; `Enter` runs the highlighted command; `Esc` or `Tab` closes                  |
| Tooltips                           | `Esc` hides the tooltip of the focused control                                                             |
| Notifications panel                | `Esc` closes it and returns focus to the bell                                                              |

### How shortcuts are kept out of the way while typing

- **Text fields.** `isTypingTarget()` returns true for `<input>`, `<textarea>`, `<select>` and content-editable
  elements, and the board's key handler returns early for those targets. The canvas text editor and the
  board-name field additionally stop their key events from propagating, so nothing reaches the board from them.
  Mod + `K` is the deliberate exception for other fields: it opens the palette even from the comment box.
- **Open overlays.** While any dialog, the command palette or the context menu is open, the board's handler
  ignores everything except Mod + `K`. The modal's own handler takes `Esc` and `Tab` in the capture phase.
- **Focused controls.** `Enter` is not taken when focus is on a button, link, tab, menu item, option or
  `<summary>`, so it activates that control instead of opening a text editor. Arrow keys are not taken inside a
  tab list, menu or list box. `Space` is not taken when a button, link, tab or menu item has focus.
- **Roles.** Editing shortcuts do nothing for viewers.

Tests: `tests/browser/board.spec.ts` "ignores canvas shortcuts while typing" (types `nvh? notes` into the comment
box and checks that no tool changed and no dialog opened), and `tests/unit/board-utilities.test.ts` "maps keys to
tools and ignores typing targets".

Single-letter shortcuts are still active whenever focus is anywhere other than a text field, and they cannot be
switched off or remapped.

### The command palette

Mod + `K` opens a searchable list of board commands: one per tool, Undo, Redo, Zoom to fit, Export as PNG, Share
board (owner), Show people, Show comments, Show activity, Show board outline, Keyboard shortcuts and Go to
dashboard. Commands that are unavailable to the current role are left out.

## Focus management

### Dialogs

`Modal` (`src/components/ui/modal.tsx`):

- On open, focus moves to the element marked `data-autofocus`, otherwise to the first focusable element that is
  not the close button, otherwise to the dialog itself. So the Share dialog opens on its "Email address" field,
  confirmations that need something typed open on that field, and confirmations with only buttons open on
  "Cancel".
- `Tab` and `Shift` + `Tab` wrap between the first and last focusable elements. If focus has somehow left the
  dialog, the next `Tab` brings it back.
- `Esc` closes. Clicking the backdrop closes too, except on destructive confirmations (transfer ownership,
  delete forever, delete board from settings, delete account).
- On close, focus returns to whatever had it before the dialog opened, provided that element is still in the
  page.
- The page behind does not scroll. It is not made `inert`; the trap relies on `aria-modal` and the key handler.

The command palette moves focus to its input and restores the previous focus on close. Dropdown menus focus
their first item and return focus to their trigger when closed with `Esc`, `Tab` or a selection.

### Other focus moves

- Choosing "Comment on this item" or "Comment on the board" opens the Comments tab and focuses the "Add a
  comment" box.
- Placing a sticky note or text item opens its editor with focus in it and the caret at the end.
- "Edit text" in the Outline focuses the text field that appears.

### Visible focus

There is one global rule in `src/app/globals.css`:

```css
:focus-visible {
  outline: 2px solid var(--color-focus); /* #2563eb */
  outline-offset: 2px;
  border-radius: 0.375rem;
}
```

Cards built around a hidden or native radio button draw the same outline on the whole card when the radio has
keyboard focus. The selection outline and resize handles on the canvas use the same colour.

Places where the global outline is replaced or suppressed:

| Element                            | What shows focus instead                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Text inputs, selects and textareas | The border changes to the focus colour, plus a 3 px ring of that colour at 20% opacity            |
| Menu items                         | Only a 6% ink background tint (computed 1.13:1 against the white menu surface)                    |
| Tab panels (which are focusable)   | Nothing visible: the classes on the panel cancel the outline. Verified in the compiled stylesheet |
| Command-palette input              | No outline; the active result is shown as a dark, inverted row                                    |

Test: `tests/browser/accessibility.spec.ts` "shows a visible focus ring on keyboard focus" presses `Tab` once and
checks that the focused element has a solid outline at least 2 px wide. It checks the first Tab stop only.

## The Board Outline

The Outline is the fourth tab of the board's side panel ("Board panel": People, Activity, Comments, Outline). It
can also be opened from the command palette with "Show board outline". Its code is `OutlinePanel` in
`src/components/board/side-panel.tsx`.

**What it lists.** One entry for every item on the canvas that has not been deleted, in stacking order (back to
front), in a list labelled "Board items". Each entry is a button whose name is the item's type followed by its
text, shortened to 60 characters:

- "Sticky note: Example: define the goal"
- "Text: Plan"
- "Rectangle (empty)" for a text-capable item with no text
- "Arrow" or "Drawing" for items that cannot hold text

**Selecting.** Activating an entry selects the item on the canvas, centres the view on it, and sets
`aria-pressed="true"` on the entry. A visually hidden live region announces "Selected: Sticky note" (the type
only).

**Actions for the selected entry.** For owners and editors a group named "Actions for <entry name>" appears
under the selected entry:

| Action                                    | What it does                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Edit text                                 | Opens a labelled "Text" field with "Save text" and "Cancel". Text-capable items only |
| Duplicate                                 | Creates a copy offset by 24 units and selects it                                     |
| Delete                                    | Deletes the item                                                                     |
| Move left, Move up, Move down, Move right | Moves the item 20 units per press                                                    |

Viewers get the list and selection, and no actions.

**What else is reachable once an item is selected.** The item toolbar above the canvas is made of ordinary
buttons and a select, so it can be reached with `Tab`: fill colour, line colour, text size, bold, bring to
front, duplicate, comment on this item, delete. It is shown to owners and editors only. The arrow-key nudge,
`Enter`, `Delete` and Mod + `D` shortcuts also act on the selected item.

**What the Outline does not provide.**

- A way to create a new item.
- Resizing, or changing the ends of an arrow.
- Any spatial information: position, size, colour, which column a note sits in, or what an arrow connects. The
  only ordering is stacking order.
- Focus handling after an action removes the control that was focused (see Known limitations).

Tests: `tests/browser/accessibility.spec.ts` "the Outline panel lists every item and selects them from the
keyboard" and "edits, moves, duplicates and deletes an item without a mouse" (both keyboard-only, with the result
checked on the test backend); `tests/components/board-panels.test.tsx` "Outline panel".

## Live regions

### What is announced

| Event                                                                | How                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Another member connects or disconnects                               | Polite status: "<Name> joined the board", "<Name> left the board"                                    |
| Someone else posts a comment                                         | Polite status: "New comment from <Name>"                                                             |
| The selection changes                                                | Polite: "Selected: <type>"                                                                           |
| Save state                                                           | Polite status with text: "Saved", "Saving", "Offline", "Reconnecting", "Sync failed", "View only"    |
| Realtime connection                                                  | Polite status with text: "Connected", "Reconnecting", "Offline"                                      |
| Saving is refused                                                    | A persistent `role="alert"` banner with "Try again" or "Log in again", and "Discard unsaved changes" |
| Access to the board is lost                                          | The page is replaced by a `role="alert"` message                                                     |
| A conflicting text edit, a rejected change, an undo that was blocked | An error toast (`role="alert"`)                                                                      |
| Confirmations ("Profile saved.", "Board moved to Trash.")            | A toast (`role="status"`)                                                                            |
| Field and form errors                                                | `role="alert"`                                                                                       |
| Copy buttons                                                         | The button text changes to "Copied" or "Copy failed" in a polite region                              |
| Join result, export result, template page number                     | Polite regions                                                                                       |

Toasts disappear on their own after 5 seconds (8 for errors) and have a "Dismiss notification" button. The
component's stated rule is that anything a person must not miss is shown inline instead; unsaved work and sync
failure follow that rule.

### What is deliberately not announced

- **Cursor movement.** Other people's cursors are drawn in a layer marked `aria-hidden`, and no live region is
  ever updated from cursor data.
- **Activity entries.** New rows in the Activity tab are not announced; the list is there to be read on demand.

### What is not announced, and arguably should be

- **Other people's changes to the canvas.** When a collaborator adds, edits, moves or deletes an item, the
  drawing and the Outline update silently. A screen-reader user has no signal that the board changed.
- **The content of the selected item.** The selection announcement gives the type only. That region is also
  added to the page together with its text rather than updated in place; whether screen readers announce it has
  not been checked.

The save-state region changes between "Saving" and "Saved" on every edit, which may be repetitive when heard.
That has not been evaluated with a screen reader.

## Colour and contrast

### Approach

All colours are design tokens declared in `src/app/globals.css` and used through Tailwind utilities. Body text
is `ink` on `warm` or `surface`; secondary text is `muted`. Pastel colours (`sky`, `lavender`, `mint`, `yellow`,
`coral` and their tints) are backgrounds only and always carry `ink` text. There is one light theme: no dark
mode, and no handling of forced-colours or increased-contrast modes.

Colour is not used as the only signal:

- Roles are written out ("Owner", "Editor", "Viewer"); see [Role and status badges](#role-and-status-badges).
- Save and connection states pair an icon with a word.
- Presence is a dot plus hidden text, and members are also grouped under "Online now" and "Offline" headings.
- Each remote cursor has the person's first name next to it.
- Invitation states are words ("Pending", "Accepted", "Declined", "Expired", "Revoked").
- Colour swatches have names ("Fill: Yellow", "Line: Blue") and a pressed state.
- Selected options show a native radio button or `aria-pressed` as well as a darker border.

### Computed ratios

These are **computed from the token hex values** with the WCAG 2 relative-luminance formula. They are not
measurements of rendered pages, they ignore anti-aliasing, font weight and size, and semi-transparent colours
were flattened against the stated background first. 4.5:1 and 3:1 are mentioned only as familiar reference
points.

| Pair                                                          | Foreground | Background | Ratio   |
| ------------------------------------------------------------- | ---------- | ---------- | ------- |
| Body text: `ink` on `warm`                                    | `#121212`  | `#fcfaf6`  | 17.97:1 |
| Body text: `ink` on `surface`                                 | `#121212`  | `#ffffff`  | 18.73:1 |
| Secondary text: `muted` on `warm`                             | `#666666`  | `#fcfaf6`  | 5.51:1  |
| Secondary text: `muted` on `surface`                          | `#666666`  | `#ffffff`  | 5.74:1  |
| Primary button: white on `black`                              | `#ffffff`  | `#111111`  | 18.88:1 |
| Active tool, Owner badge, toasts: white on `ink`              | `#ffffff`  | `#121212`  | 18.73:1 |
| Danger button: white on `error`                               | `#ffffff`  | `#c0392b`  | 5.44:1  |
| Field error text: `error` on `surface`                        | `#c0392b`  | `#ffffff`  | 5.44:1  |
| Field error text: `error` on `warm`                           | `#c0392b`  | `#fcfaf6`  | 5.22:1  |
| Error notice text on `coral-tint`                             | `#7d241b`  | `#fbe6e4`  | 8.20:1  |
| Success notice text on `mint-tint`                            | `#17563a`  | `#e6f5e9`  | 7.66:1  |
| Warning notice text on `yellow-tint`                          | `#6b470f`  | `#fdf5d4`  | 7.57:1  |
| Info notice: `ink` on `sky-tint`                              | `#121212`  | `#e6f3fa`  | 16.56:1 |
| Editor badge: `ink` on `lavender-tint`                        | `#121212`  | `#e9ecfc`  | 15.94:1 |
| Viewer badge: `muted` on `surface`                            | `#666666`  | `#ffffff`  | 5.74:1  |
| Note text: `ink` on `yellow`                                  | `#121212`  | `#f8dd72`  | 13.90:1 |
| Note text: `ink` on `sky`                                     | `#121212`  | `#a8d8f0`  | 12.26:1 |
| Note text: `ink` on `mint`                                    | `#121212`  | `#a8ddb2`  | 12.18:1 |
| Note text: `ink` on `lavender`                                | `#121212`  | `#aeb9f4`  | 9.85:1  |
| Note text: `ink` on `coral`                                   | `#121212`  | `#f3a5a0`  | 9.55:1  |
| Focus outline: `focus` on `surface`                           | `#2563eb`  | `#ffffff`  | 5.17:1  |
| Focus outline: `focus` on `warm`                              | `#2563eb`  | `#fcfaf6`  | 4.96:1  |
| **"Saved" status and online dot: `success` on `surface`**     | `#268a57`  | `#ffffff`  | 4.33:1  |
| **"Offline" / "Reconnecting" status: `warning` on `surface`** | `#b7791f`  | `#ffffff`  | 3.64:1  |
| **Placeholder text: `muted` at 70% on `surface`**             | `#949494`  | `#ffffff`  | 3.03:1  |
| **Input and card border: `line` on `surface`**                | `#e9e5df`  | `#ffffff`  | 1.25:1  |
| **Hover border, offline dot: `line-strong` on `surface`**     | `#d6d0c6`  | `#ffffff`  | 1.53:1  |
| **Switch in the off position: `line` track on `surface`**     | `#e9e5df`  | `#ffffff`  | 1.25:1  |
| **Menu item focus tint: `ink` at 6% on `surface`**            | `#f1f1f1`  | `#ffffff`  | 1.13:1  |

Remote cursor labels are white 11 px text on one of eight colours chosen per person. Computed against white:
`#BE185D` 6.04:1, `#7C3AED` 5.70:1, `#C0392B` 5.44:1, `#0E7490` 5.36:1, `#2563EB` 5.17:1, `#4D7C0F` 4.99:1,
`#268A57` 4.33:1, `#B7791F` 3.64:1.

The rows in bold are the ones to look at first: two status colours used for 13 px text, placeholder text, and
the boundaries of form fields and switches, which are very faint against white.

Colours on a board are chosen by its members from fixed palettes (six fills, five line colours). Text on the
canvas is `ink` by default; the text colour cannot be changed from the interface.

## Reduced motion

`globals.css` contains one rule for `prefers-reduced-motion: reduce`. It applies to every element and
pseudo-element and sets animation duration and transition duration to 0.001 ms, animation iteration count to 1,
and scroll behaviour to `auto`, all with `!important`.

That covers every animation in the product, since all of them are CSS: toast and dialog entrances, the skeleton
shimmer, spinners, the "Reconnecting" icon, hover transitions, the smoothing of remote cursor movement, and the
one piece of page-load motion on the landing page (a note moving between columns), which jumps to its end state.
With reduced motion on, spinners do not spin; loading is still conveyed by text ("Saving", "Creating board",
"Loading board").

Apart from loading indicators (shimmer and spinners), nothing loops, and the landing-page animation plays once
for about three seconds. There is no parallax or scroll-triggered animation. Camera changes on the board (zoom to
fit, centring on an item) are instant jumps in all cases.

This rule is not covered by an automated test.

## Zoom and reflow

- **Browser zoom is not disabled.** The viewport meta tag is `width=device-width, initial-scale=1` with no
  maximum scale.
- **Ordinary pages reflow.** The dashboard, templates, settings, auth and legal pages are single-column or
  responsive grids. Below 1024 px the sidebar becomes a horizontally scrolling bar; dialogs become bottom sheets
  that scroll internally (at most 92% of the viewport height); the public navigation collapses into a native
  `<details>` menu.
- **The board is a fixed, full-viewport layout** with page overflow hidden. At narrower widths the top bar hides
  the role badge, the board-settings link, the online avatars and the unsaved-change count, and the Export button
  becomes icon-only with a hidden text label. At 900 px and below, the side panel starts closed and overlays the
  canvas when opened.
- **The canvas has its own zoom**, from 10% to 400%, through the zoom buttons, Mod + scroll, and the Mod + `+`,
  `-`, `0` shortcuts. Canvas text scales with it. This is separate from browser zoom.
- Many text sizes are set in pixels (13 px and 15 px are common), so they follow browser zoom but not a
  text-only size preference.

None of this has been tested at 200% or 400% browser zoom, at a 320 px viewport, or with increased text spacing.
The board's fixed layout is the most likely place for content to be clipped.

## Role and status badges

`RoleBadge` and `StatusBadge` (`src/components/ui/badge.tsx`) always render a text label:

| Badge      | Text                                                                     | Other cue          |
| ---------- | ------------------------------------------------------------------------ | ------------------ |
| Role       | "Owner", "Editor", "Viewer"                                              | Colour of the pill |
| Save state | "Saved", "Saving", "Offline", "Reconnecting", "Sync failed", "View only" | Icon and colour    |
| Connection | "Connected", "Reconnecting", "Offline"                                   | Icon               |
| Invitation | "Pending", "Accepted", "Declined", "Expired", "Revoked"                  | Colour of the pill |

`StatusBadge` and the connection indicator are `role="status"` with `aria-live="polite"`. Tests:
`tests/components/ui.test.tsx` "always writes the role out in text" and "announces every save state as a polite
status with a text label".

## What the automated tests cover

Nothing in the test suite is an accessibility audit. There is no rule-based scanner (such as axe), no contrast
check, and no screen-reader automation. What exists are behavioural tests of specific promises.

### Browser tests (`tests/browser/accessibility.spec.ts`)

Nine tests, run in Chromium at 1440 × 900 against the board mounted in a test harness with an in-memory backend.
They exercise the real board components, but not the Next.js pages around them, so the skip link, the app shell,
auth pages, dashboard and settings are not in these tests.

| Test                                                                                   | What it establishes                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| the Outline panel lists every item and selects them from the keyboard                  | One list entry per canvas item, named by type and text; `Enter` selects and sets `aria-pressed`                       |
| edits, moves, duplicates and deletes an item without a mouse                           | The Outline actions work from the keyboard and reach the backend                                                      |
| the share dialog traps focus, closes on Escape and returns focus to its trigger        | `aria-modal`, initial focus on the first field, 25 `Tab` and 8 `Shift`+`Tab` presses stay inside, `Esc` returns focus |
| invites by email from the share dialog and shows the link once                         | The empty-field error is exposed as an alert; the form works by label                                                 |
| tools are a labelled toolbar with pressed state, and tabs follow the arrow-key pattern | Toolbar name, 11 named buttons, `aria-pressed`, arrow and `End` keys on tabs                                          |
| opens shortcut help with ? and the command palette with Ctrl+K                         | Both open and close from the keyboard; the palette input is focused and `Enter` runs a command                        |
| offers a context menu that is operable by keyboard                                     | Once opened (by right-click), the menu takes focus and responds to arrows and `Enter`                                 |
| every icon-only button has an accessible name, and status changes are live regions     | No button or link on the board lacks text, `aria-label` or `aria-labelledby`; the two status regions are polite       |
| shows a visible focus ring on keyboard focus                                           | The first Tab stop has a solid outline of at least 2 px                                                               |

One assertion in that file is weaker than its comment suggests: the check that remote cursors are hidden from
assistive technology asserts a count "greater than or equal to 0", which cannot fail. The cursor layer is marked
`aria-hidden` in `canvas-stage.tsx`, but no test proves it.

Related tests in `tests/browser/board.spec.ts`: "ignores canvas shortcuts while typing", "undoes and redoes with
the keyboard", "adds a sticky note with the N shortcut and saves it", "gives a viewer a read-only board" (tools
are `aria-disabled`, status reads "View only").

### Component tests (`tests/components`, jsdom)

| File                    | Accessibility-relevant checks                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui.test.tsx`           | Wordmark name; busy buttons; icon buttons need a label; role and status text; avatar `alt` and presence text; avatar stack summary; hint and error linkage; switches; modal labelling, focus entry, Tab trap, `Esc` and focus return, scroll lock; tabs keyboard pattern; dropdown menu keys and focus return; toast roles and dismissal |
| `board-panels.test.tsx` | Outline lists items by type and text, exposes actions for the selected item, and offers none to a viewer; honest empty and loading states                                                                                                                                                                                                |
| `auth-forms.test.tsx`   | Inline errors for every missing field; the password visibility toggle; server-side field errors shown next to the field                                                                                                                                                                                                                  |
| `app.test.tsx`          | Cookie banner and preferences dialog; confirmation dialogs on board cards                                                                                                                                                                                                                                                                |

## Known limitations

Barriers, most serious first.

1. **The canvas is not navigable by screen reader or keyboard.** Items on it have no roles, names or focus. The
   Outline is the only structured route, and it conveys no layout, so a diagram's meaning, which is mostly
   spatial, is largely lost.
2. **New items cannot be created without a pointer.** Every creation tool needs a click or drag on the canvas.
   From the keyboard the only way to add something is to duplicate an existing item and edit it. On an empty
   board a keyboard-only user cannot add anything.
3. **Resizing, drawing, arrows and arrow ends need a pointer.** There is no keyboard equivalent.
4. **Other people's canvas changes are not announced**, and the selection announcement gives only the item type.
5. **The canvas cannot be panned from the keyboard.** The view moves only by zooming or by selecting an item in
   the Outline, which centres it.
6. **The canvas context menu opens only by right-click.** The canvas is not focusable, so the keyboard's
   context-menu key cannot target it. Its commands are available elsewhere (item toolbar, Outline, command
   palette), except "Comment on this item" for viewers who are allowed to comment, which needs the Comment tool
   and a click.
7. **Browser zoom shortcuts are taken over on the board.** Mod + `+`, `-` and `0` zoom the canvas and suppress
   the browser's own zoom whenever focus is on the board and not in a text field or dialog. Browser zoom is still
   available from the browser menu.
8. **Single-letter shortcuts cannot be turned off or remapped.** They fire whenever focus is outside a text
   field, which can misfire for people using speech input.
9. **Focus is not managed after some actions.** Deleting an item from the Outline, or saving or cancelling its
   text edit, removes the focused control without moving focus anywhere. Closing the canvas context menu does not
   return focus either.
10. **Some focus indicators are missing or faint**: focusable tab panels show none, menu items show only a very
    light tint, and text fields replace the outline with a border-colour change and a low-opacity ring.
11. **Some contrast values are low** by computation: "Saved" (4.33:1) and "Offline"/"Reconnecting" (3.64:1) status
    text at 13 px, placeholder text (3.03:1), two cursor-label colours, and the borders of inputs, cards and
    switches (1.25:1).
12. **The owner's board page has no `<h1>`,** and the board page's document title is "Board" for every board.
13. **The tool rail is a `toolbar` without arrow-key navigation.** Each of its twelve controls is a separate Tab
    stop before the rest of the page.
14. **Disabled tools give no reason to screen-reader users.** "(view only)" appears only in the tooltip.
15. **Toasts time out** after 5 or 8 seconds with no way to extend them.
16. **The notifications panel does not take focus when opened**, and tooltips cannot be hovered over themselves.
17. **Mobile and touch editing is not optimised.** The canvas is built for desktop. There is no pinch-zoom
    gesture on the canvas, and several targets are small: resize handles 12 px, colour swatches 24 px, compact
    icon buttons 32 px.
18. **No dark mode, and no testing in forced-colours or high-contrast modes.** How the SVG canvas and the custom
    switches render there is unknown.
19. **Exported PNGs have no text alternative.** The JSON data export contains the board's text.
20. **One confirmation uses the browser's native `confirm()` dialog** ("Discard the changes that haven't been
    saved?").
21. **English only.**

Process gaps:

- **No formal audit and no testing with assistive technology.** Nothing has been tried with NVDA, JAWS,
  VoiceOver, TalkBack, a screen magnifier, switch access or speech input.
- **No automated rule scanning** and no contrast testing in CI.
- **Chromium only**, desktop viewport only, and only the board in a real browser. Firefox and Safari are
  untested.
- **Not tested at 200% or 400% zoom, at small viewports, or with user text-spacing overrides.**
- **The app has never run against a live backend**, so real-world timing of announcements (presence, comments,
  connection state) is unobserved.

If you depend on assistive technology, expect to be able to sign up, manage boards, read a board's content
through the Outline, edit and rearrange existing items, comment and follow activity. Expect not to be able to
build a diagram from scratch or understand its layout without sighted help.
