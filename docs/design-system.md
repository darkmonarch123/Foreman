# Design system

Foreman's visual language: a warm, quiet canvas with Foreman lavender as the one accent. Everything is defined as
tokens in `src/app/globals.css` (Tailwind v4 `@theme`), so components never use fixed colours.

## Tokens

### Colour (semantic)

| Token                                      | Light               | Dark                | Use                                                |
| ------------------------------------------ | ------------------- | ------------------- | -------------------------------------------------- |
| `canvas`                                   | `#f7f6f3`           | `#121216`           | Page background                                    |
| `sunken`                                   | `#efede8`           | `#0e0e12`           | Wells, tracks                                      |
| `surface`                                  | `#ffffff`           | `#1a1a20`           | Cards, bars, panels                                |
| `elevated`                                 | `#ffffff`           | `#22222a`           | Menus, sheets, dialogs                             |
| `ink` / `muted`                            | `#18181b`/`#5c5c66` | `#ececf1`/`#a6a6b1` | Text                                               |
| `line` / `line-strong`                     | `#e6e3dd`/`#d3cec5` | `#2c2c35`/`#3d3d48` | Borders                                            |
| `accent` / `on-accent`                     | `#5458c9`/`#ffffff` | `#a9aefa`/`#17173a` | Primary buttons, selected tools (Foreman lavender) |
| `accent-ink` / `accent-soft`               | `#4448b0`/`#ecedfc` | `#b9bdfb`/`#262849` | Accent text, selected rows                         |
| `success`, `warning`, `danger` (+ `-soft`) | AA on their soft    | AA on their soft    | States and notices                                 |
| `on-danger`                                | `#ffffff`           | `#2a0f0d`           | Text on a danger fill                              |
| `focus`                                    | `#4d55e0`           | `#a9aefa`           | Focus rings (3:1 against surfaces)                 |
| `board` / `board-dot`                      | `#fbfaf7`/`#d9d3c8` | `#16161b`/`#2e2e37` | The board and its dot grid                         |
| `scrim`                                    | 42% ink             | 60% black           | Behind sheets and dialogs                          |

Dark mode is layered (canvas → surface → elevated get lighter) and never uses pure black.
`tests/unit/theme.test.ts` checks every text pair the components use for WCAG AA (4.5:1) in both themes, that the
two dark blocks are identical, and that no dark surface is `#000000`.

### Type, spacing, radius, elevation, motion

- Type: `display`, `headline`, `title`, `body` (15px), `label` (13px); Inter for UI, Fraunces for display.
- Spacing: Tailwind's 4px scale plus `touch` (44px), `touch-gap` (12px) and `gutter` (16px).
- Radius: `chip` 8, `control` 12, `card` 20, `sheet` 24, `panel` 32.
- Elevation: `soft`, `lift`, `note`, `sheet` shadows, darker in dark mode.
- Motion: `ease-standard`, `ease-emphasized`; `sheet-in`, `pop-in`, `toast-in`. All motion stops under
  `prefers-reduced-motion`.

## Light, Dark and System

- The choice lives in this browser (`localStorage["foreman:theme"]`, only the word `light` or `dark`) and, when
  signed in, on the account (`profiles.theme_preference`, set by `set_theme_preference`). On sign-in the account's
  choice wins; after that both are updated together.
- A tiny inline script in `<head>` applies the theme before first paint, so there is no flash. "System" follows the
  operating system live.
- Change it from the account menu, Settings → Appearance, or the board's More menu.

### The board in dark mode

Objects keep their real colours (they were chosen on a light board and are exported as they are). On screen, the
board's content layer is drawn with lightness inverted and hue kept (`filter: invert(0.9) hue-rotate(180deg)` on
`.board-ink`): black ink becomes light, white shapes become dark, pastel notes become deep tints of the same colour,
and text stays readable on every note. Board previews use the same layer. PNG export draws stored colours.

## Layout and breakpoints

| Width                  | Board layout                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone, below 744px     | Canvas fills the screen. Compact floating top bar. Bottom toolbar: Add, Select/Edit, Comments, Outline, Assistant, More. Everything else opens as a bottom sheet. |
| Tablet, 744–1279px     | Top bar, side tool rail, floating item bar, zoom controls; the panel overlays (744) or sits beside (1024+).                                                       |
| Desktop, 1280px and up | Full board toolbar: select/pan · add · style · arrange · align · zoom; Comments, Assistant, Export, More.                                                         |

Breakpoint tokens: `tablet` (46.5rem) and Tailwind's `lg`/`xl`. Safe-area insets are respected by the floating
top bar, the bottom toolbar and every sheet.

## Touch

- Touch targets are at least 44×44 with 12px between neighbours in the phone toolbar and sheets; icon buttons grow
  to 44px on coarse pointers (`pointer-coarse:`).
- Press and hold an item for its menu (the touch equivalent of right-click). Two fingers pinch to zoom.
- Icons always have a label: visible text in the phone toolbar and sheets, a tooltip and accessible name elsewhere.

## Shared primitives

`src/components/ui`: `Button`, `IconButton`, `LinkButton`, `Modal` (with a `sheet` variant), `DropdownMenu` /
`ContextMenu` (with a header slot and radio items), `Tabs`, `Tooltip`, `Toast`, `Notice`, `Badge`, `Field`
inputs, `Skeleton`, `Avatar`, `EmptyState`. Theme: `src/components/theme` (`ThemeController`, `ThemeChoice`).
