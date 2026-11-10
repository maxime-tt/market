# Home intro animation — design document

**Branch** `d7s2/intro-animation` · **Date** 2026-11-10

---

## 1. Mission

Add a cinematic entrance over the existing idle hero. The animation plays while data loads
in the background; its final frame is pixel-identical to the hero's first painted frame so
the handoff is invisible.

---

## 2. Font decisions

### "Plebeian" — the app's display face

The app already ships **Reglisse** (loaded via `@font-face` in `styles/globals.css`, exposed
as Tailwind's `font-display`). This is the display face the frames use for the brand.
No webfont change — we reuse `font-display` everywhere "Plebeian" appears in the intro.

### "Market" — system serif italic

"Market" types in as a distinct font. We **do not** add a new webfont. Instead we use the
browser's default serif (`font-serif`) in italic: `font-serif italic`.

**Why system serif:**

1. The brief says "no webfont" for "Market" — we honour that literally.
2. A system serif is a deliberate visual contrast to the geometric reglisse; it reads as
   a humanistic, editorial type against the bold display face — exactly the tension an
   intro typing animation should create.
3. Zero layout cost: the font already exists in every browser's fallback stack. No
   `@font-face` to load, no paint stall, no layout shift.

### Spelling: "Plebeian"

The project, repo and domain are all **Plebeian** (not "Plebian"). The wordmark states
**Plebeian Market**.

---

## 3. Keyframe storyboard

All timings are approximate. GSAP `Ease` values map to Material 3 curves already defined
in `globals.css` (`--ease-emphasized-decelerate` / `--ease-emphasized-accelerate`).

### Keyframe 0 — t=0 ms

| Layer         | Action                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| Background    | Solid black. A blue-tinted gradient begins drifting from left to right.         |
| Logo          | Hidden (`opacity: 0`).                                                          |
| Wordmark      | Hidden.                                                                         |
| Search field  | Hidden.                                                                         |
| Stats line    | Hidden.                                                                         |
| Product cards | All visible (existing strips), but overlayed by a black veil (`opacity: 0.85`). |

### Keyframe 1 — t=0 ms → t=500 ms

| Layer      | Action                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| Background | **Flash**: black → white in 0.5 s, transitioning from a blue highlight on black |

(`#0b1365 → #ffffff`) to a slight pink tint on white (`#f0e6f0 → #ffffff`).
The gradient continues drifting for the entire intro. |
| Veil | Fades from 0.85 → 0 over 400 ms (completes before wordmark). |

### Keyframe 2 — t=300 ms → t=800 ms

| Layer                                    | Action                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Logo                                     | Fades in (`opacity: 0 → 1`) over 500 ms, centred.                           |
| "Plebeian" text                          | Swoops in from the logo position to the right, staying horizontally centred |
| throughout. Expands outward from centre. |

### Keyframe 3 — t=800 ms → t=1100 ms

| Layer    | Action                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| "Market" | Types in character-by-character (3 letters, 100 ms each + 40 ms cursor blink |

between chars = ~360 ms). Uses `font-serif italic` so it is visually distinct from the
reglisse "Plebeian". |

### Keyframe 4 — t=1100 ms → t=1800 ms

| Layer                                                                               | Action                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Title block                                                                         | Floats up (`y: 30px → 0px`, `opacity: 0 → 1`) over 700 ms to land                |
| exactly at the hero title position.                                                 |
| Search field                                                                        | Fades in (`opacity: 0 → 1`) over 500 ms starting at t=1200 ms, positioned        |
| under the title block.                                                              |
| Stats line                                                                          | Types in below search, using real `feed.stats` counts. Counters scroll from 0 to |
| their values (all three: products/sellers, postedLast24h, relays). Duration 600 ms. |

### Keyframe 5 — t=1800 ms → t=2800 ms

| Layer         | Action                                                                 |
| ------------- | ---------------------------------------------------------------------- |
| Product cards | Cards appear one by one, staggered over ~1000 ms. Effect: fade-in with |

a slight rise from bottom (`y: 12px → 0px`, `opacity: 0 → 1`). The row keeps scrolling
as cards appear — it looks like live data insertion. Not a zoom. |

### Total intro duration: ~3 s (idle-to-hero handoff at t=3000 ms)

---

## 4. Gradient palettes

The gradient is a CSS `radial-gradient` on an absolutely-positioned layer behind everything.
It drifts via `background-position` animation.

### On black (start frame)

```
radial-gradient(ellipse 80% 60% at 20% 40%,
  #0b1365 0%,      /* deep blue, 12% opacity */
  transparent 70%),
radial-gradient(ellipse 60% 50% at 80% 60%,
  #1a0a2e 0%,      /* deep purple accent */
  transparent 60%)
```

### On white (end frame)

```
radial-gradient(ellipse 80% 60% at 60% 30%,
  #e8d5f5 0%,      /* light pink-purple, 40% opacity */
  transparent 60%),
radial-gradient(ellipse 50% 70% at 30% 70%,
  #f5e6d0 0%,      /* warm sand */
  transparent 50%)
```

The transition is a single background-color fade on the overlay layer (black → white) while
the gradient `background-position` animates from start to end position simultaneously.
The gradient itself is rendered on a layer whose opacity goes from 1 → 0 during the flash
(so the blue/pink highlights don't fight the background transition).

**CSS variable tokens** for reuse:

```css
--intro-gradient-start: radial-gradient(ellipse 80% 60% at 20% 40%, #0b1365 0%, transparent 70%);
--intro-gradient-end: radial-gradient(ellipse 80% 60% at 60% 30%, #e8d5f5 0%, transparent 60%);
```

---

## 5. Feature flag

Single boolean: `INTRO_ANIMATION_ENABLED` (env-var or config).

```ts
export const INTRO_ENABLED = typeof process !== 'undefined' && process.env?.INTRO_ANIMATION_ENABLED === 'true'
```

When `false`: the intro is completely absent; the page renders the existing BrowseIdle
immediately, same as before. No conditional rendering path — the flag guards the wrapper
component that sits around BrowseIdle.

---

## 6. Reduced motion path

If `window.matchMedia('(prefers-reduced-motion: reduce)').matches`:

- Skip all animation phases.
- Render the hero as it would appear at the end of the intro (logo + wordmark + search
  field + stats + visible product cards).
- No flash, no typing, no stagger.
- One render cycle.

Implementation: check `prefers-reduced-motion` on mount; if true, skip GSAP timeline
construction entirely and render the final state.

---

## 7. The two absent behaviours

### 7.1 Search-on-type

Typing in the hero search field at top level triggers:

1. Animate the search field upward toward the nav position.
2. Fade page contents away (opacity 1 → 0.3) as search results stream in.
3. The existing `NAV_SEARCH_HANDOFF_PX = 8` scroll handoff is preserved — it is the
   mechanism that swaps the field from hero to nav when scrolled.

**Does not touch**: the existing scroll handoff, the route state, or the nav search field
logic. This adds an overlay animation layer on top.

### 7.2 Logo → blank home (Google mode)

Clicking the Plebeian logo during idle state:

1. The search bar animates down to the centre, over a blank white background.
2. Page contents (strips, category rows, CTAs) fade away over 300 ms.
3. After ~1500 ms with no typing, products fade back in staggered over 800 ms.
4. The search bar returns to its original hero position.

**Does not touch**: route state, search query, or any existing navigation logic. This is
purely a visual layer.

---

## 8. Handoff technique

The intro and the hero share the **same DOM elements**. The intro doesn't create a separate
title block or search field — it overlays animations on the existing `BrowseIdle` structure.

**How it works:**

1. The intro wrapper mounts the existing `BrowseIdle` component normally.
2. A GSAP timeline captures the computed styles of the title, search, and CTAs.
3. During the intro, the intro layer overlays an animation layer with:
   - The gradient background (absolute, behind content)
   - Logo + wordmark (absolute, centred over the title)
   - The typing "Market" text (absolute, appended to the "Plebeian" in the wordmark)
4. At handoff, the intro layer is removed, and the real hero is already visible underneath.

**Why no layout shift:**

The title block, search, and CTAs are the real DOM nodes from `BrowseIdle`. The intro
adds an overlay layer that sits on top (absolute positioning) and animates its own elements.
When removed, nothing shifts because the underlying hero was always there.

**Position alignment:**

The intro logo/wordmark overlay is positioned at the same coordinates as the BrowseIdle
title block (centred at `max-w-[800px]` with `text-center`). The hero's `<h1>` already
has `font-display text-3xl sm:text-4xl lg:text-5xl font-medium leading-tight
tracking-tight` — we match these exactly in the intro overlay.

---

## 9. Stats — no fabricated counters

Every number comes from `feed.stats` (the same source `BrowseIndexHost` uses):

- `products` → "N items loaded from N sellers"
- `postedLast24h` → "N posted in the last 24 hours"
- `relays` → "N relay queried"

The intro does **not** invent, guess, or placeholder these values. If `feed.stats` is not
available, the intro skips the stats animation and proceeds with the visible hero.

---

## 10. Files changed

| File                                 | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| `ui/browse/intro-animation.tsx`      | Main intro component, GSAP timeline                 |
| `ui/browse/intro-choreography.ts`    | State machine for choreography phases               |
| `ui/browse/intro-counters.ts`        | Counter formatting (scroll animation values)        |
| `ui/browse/intro-search-on-type.tsx` | Search-on-type behaviour (§7.1)                     |
| `ui/browse/intro-google-mode.tsx`    | Google-mode logo click (§7.2)                       |
| `ui/browse/DESIGN.md`                | This document                                       |
| `ui/browse/intro-animation.test.tsx` | Unit tests for state machine and counter formatting |
| `e2e/tests/intro-animation.spec.ts`  | Playwright spec                                     |

---

## 10. Verification gaps

- The video recording of the intro at real speed cannot be produced here — needs a browser.
- Handoff frame comparison (intro last frame vs hero first frame) needs a browser.
- The GSAP animation timing looks correct in theory but needs visual verification.
- Reduced-motion path: logic is sound but needs a browser with the media query active.
