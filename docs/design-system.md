# Site design system (landing page)

The public landing page at `/` uses a calm, system-font design language: generous white space, large tightly
tracked headlines, translucent "glass" chrome, soft colour fields, and spring-based motion that can be grabbed and
redirected. The rest of the product (dashboard, boards, auth and legal pages) keeps its own look; nothing here
changes it.

The visual reference was a single HTML mock-up. It was converted into Tailwind CSS v4 tokens, a handful of shared
React components, and a server-rendered page with small client "islands" for interaction. The mock-up itself is not
part of the repository.

## Where things live

| What                | Where                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens (both modes) | `src/app/globals.css`: `@theme inline` / `@theme` blocks, and the `.site` scope                                                                                                       |
| Shared primitives   | `src/components/ui/`: `container`, `section`, `card`, `badge` (`Badge`), `navbar`, `footer`, `feature-card`, `pricing-card`, plus `accent`/`glass` variants and `xl` size on `button` |
| Landing-only pieces | `src/components/landing/`: hero preview, template gallery, scroll motion, links, story layouts                                                                                        |
| Spring maths        | `src/lib/spring.ts`                                                                                                                                                                   |
| The page            | `src/app/page.tsx` (a Server Component)                                                                                                                                               |

## Scoping

Site colours are CSS variables defined only inside an element with the `site` class, and exposed as Tailwind
utilities through `@theme inline` (`bg-site-bg`, `text-site-label-2`, `ring-site-accent`, …). Outside `.site` those
utilities resolve to nothing, so they cannot leak into the app by accident. The landing page's root element is
`<div class="site">`.

Dark Mode follows the operating system (`prefers-color-scheme`); there is no in-page toggle. The `.site` scope
redefines every colour variable for dark, so components never need `dark:` variants for site colours. A few
illustrations use `dark:` for one-off colours (feature icon strokes, two icon tiles).

## Tokens

### Colour

| Token                            | Light                 | Dark                  | Use                                            |
| -------------------------------- | --------------------- | --------------------- | ---------------------------------------------- |
| `site-bg`                        | `#fbfbfd`             | `#000000`             | Page                                           |
| `site-bg-alt`                    | `#f5f5f7`             | `#101012`             | Alternate bands, muted cards, footer           |
| `site-surface`                   | `#ffffff`             | `#1c1c1e`             | Raised cards, product window                   |
| `site-label`                     | `#1d1d1f`             | `#f5f5f7`             | Primary text                                   |
| `site-label-2`                   | `#6e6e73`             | `#a1a1a6`             | Secondary text (≥ 4.5:1 on every site surface) |
| `site-label-on-tint`             | `#424245`             | `#c7c7cc`             | Secondary text placed on the aurora            |
| `site-line` / `-line-strong`     | black 8% / `#d2d2d7`  | white 12% / `#3a3a3c` | Hairlines and dividers                         |
| `site-accent` / `-hover`         | `#0071e3` / `#0077ed` | same                  | Primary buttons (white text, 4.7:1)            |
| `site-link`                      | `#0066cc`             | `#2997ff`             | Text links, badge text                         |
| `site-success`                   | `#1d7a35`             | `#30d158`             | "Saved"                                        |
| `site-glass`                     | white 62%             | `#1e1e20` 62%         | Glass background (with blur and saturate)      |
| `site-plan/build/test`(+`-card`) | pastel tints          | deep tints            | Board columns and cards in illustrations       |

Sticky notes in illustrations stay pastel with dark text in both modes, like real sticky notes.

### Type

System UI first (San Francisco on Apple devices), then the bundled Inter (`--font-site`). No web font is fetched;
the CSP allows none. Tracking tightens and leading shortens as size grows; body text stays near zero.

| Utility               | Size                            | Leading | Tracking | Weight |
| --------------------- | ------------------------------- | ------- | -------- | ------ |
| `text-site-display`   | `clamp(2.75rem, 7vw, 5rem)`     | 1.05    | −0.045em | 700    |
| `text-site-h2`        | `clamp(2.25rem, 5vw, 3.5rem)`   | 1.07    | −0.04em  | 700    |
| `text-site-statement` | `clamp(1.9rem, 4.4vw, 3.25rem)` | 1.15    | −0.035em | 600    |
| `text-site-h3`        | `1.75rem`                       | 1.14    | −0.03em  | 700    |
| `text-site-lede`      | `clamp(1.1875rem, 2vw, 1.5rem)` | 1.38    | −0.02em  |        |
| `text-site-sub`       | `1.3125rem`                     | 1.38    | −0.02em  |        |
| `text-site-body`      | `1.0625rem`                     | 1.47    | −0.022em |        |
| `text-site-small`     | `0.875rem`                      | 1.43    | −0.01em  |        |
| `text-site-caption`   | `0.75rem`                       | 1.5     |          |        |

Sizes are in `rem`, so they scale with the browser's text size; layouts wrap rather than clip.

### Spacing, radius, elevation, motion

| Group     | Tokens                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing   | `py-section` (7.5rem), `py-section-sm` (5.5rem, phones), `py-statement` (10rem); content column `--container-site` 67.5rem with a 22px gutter           |
| Radius    | `rounded-site-sm` 12px, `rounded-site-md` 18px, `rounded-site-lg` 28px; pills `rounded-full`                                                            |
| Elevation | `shadow-site-lg` (product window, story stage), `shadow-site-hover` (cards on hover), `shadow-site-glass` (via `.site-glass`)                           |
| Motion    | `ease-site-spring` (gentle overshoot, small controls), `ease-site-smooth` (settles), `animate-site-rise` (hero entrance), `animate-site-drift` (aurora) |

Interactive motion uses real springs (`src/lib/spring.ts`), parameterised by damping ratio and response: damping 1
(no overshoot) by default, a little bounce only after a throw. Springs start from the current on-screen value, so a
moving card can be caught and redirected.

## Responsive behaviour

Mobile first. Verified at 393×852 (iPhone 14 Pro), 430×932 (iPhone 14 Pro Max), 744×1133 (iPad Mini) and
1440×900 (desktop), in light and dark, by `tests/browser/landing.spec.ts`.

- Below 1024px the navigation collapses to a menu button; the panel opens from the button and closes on Escape,
  a link, or a click outside.
- Below 680px the product window stacks its columns and hides secondary chrome; the pinned story shows the picture
  above one step at a time.
- The page draws under the notch (`viewport-fit=cover`); the navigation, gutters and footer pad themselves with
  `env(safe-area-inset-*)`.
- Every button and link in the header and every call to action is at least 44×44px.
- No horizontal scrolling at any tested size, including with the root text size raised to 150%.

## Accessibility notes

See [Accessibility](accessibility.md#landing-page) for landmarks, focus, motion and contrast.

## Adding to it

Use the existing tokens and components first. A new colour goes into the `.site` scope with both a light and a dark
value, and a `@theme inline` alias; check its contrast against `site-bg`, `site-bg-alt` and `site-surface` in both
modes. Keep motion on `transform` and `opacity`, and give it a reduced-motion path.
