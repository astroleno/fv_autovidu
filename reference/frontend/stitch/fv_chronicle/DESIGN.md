# Design System Specification: High-End Editorial Newsprint

## 1. Overview & Creative North Star
**Creative North Star: The Kinetic Broadsheet**
This design system moves away from the "software-as-a-service" aesthetic and into the realm of "High-End Editorial." For an AI Video Production Studio, the interface must feel like a precision tool wrapped in the authority of a legacy news publication. We celebrate the grid, prioritize high information density, and use stark geometry to convey a sense of cinematic permanence. 

By rejecting the "pill-shaped" trends of modern UI, we establish a signature visual identity that is unyielding, structured, and intentional. We don't just display data; we publish it.

---

## 2. Colors & Texture
The palette is rooted in the physical world—ink on paper, accented by a digital-first Emerald Green.

### The Palette
- **Background (`surface`):** `#F9F9F7` (The "Paper" stock)
- **Foreground (`on-surface`):** `#111111` (The "Ink" black)
- **Brand Accent (`primary`):** `#168866` (Emerald Green)
- **Warning (`tertiary`):** `#F59E0B` (Amber)
- **Structure (`outline-variant`):** `#E5E5E0` (The "Fold" grey)

### The "Visible Skeleton" Rule
Unlike traditional systems that hide structure, this system celebrates it. Section boundaries are defined by **1px solid `#111111` borders**. Never use soft shadows or background shifts to separate major sections. If a section needs to feel secondary, use the `outline-variant` (#E5E5E0) for the stroke.

### Signature Textures
- **The Dot Grid:** Apply a subtle 12px x 12px dot grid to the `surface` background to prevent the off-white from feeling "flat."
- **The Line Overlay:** For hero sections or data-heavy dashboards, use a 1px vertical line repeating every 80px to create an underlying architectural rhythm.
- **Imagery:** All video thumbnails or team photos should utilize a CSS grayscale filter (0.8 saturation) by default, returning to full color only on hover to maintain the "printed" aesthetic.

---

## 3. Typography: Editorial Authority
We utilize **Manrope** but treat it with the discipline of a typographer.

- **Display & Headline:** Use `display-lg` and `headline-lg` for impactful statements. These should be set with tight letter-spacing (-0.02em).
- **The Serif Simulation:** To achieve "Editorial Authority" without adding a new font, use `title-lg` in all-caps with increased tracking (+0.05em) for section headers.
- **Monospace Data:** For AI processing stats, timestamps, and technical metadata, use a monospace font-family (system-default) at `label-sm` size.
- **Labels:** All UI labels (buttons, navigation, form titles) must be **UPPERCASE** to differentiate them from editorial body copy.

---

## 4. Elevation & Depth: The Hard Offset
In this system, depth is not an illusion of light—it is a physical displacement.

- **The Layering Principle:** Depth is achieved by "stacking" objects. When a card or button is active or hovered, it does not glow; it shifts.
- **The Hard Shadow:** Forbid soft, Gaussian blurs. Any "floating" element must use a **Hard Offset Shadow**: `4px 4px 0px 0px #111111`.
- **The "No-Radius" Rule:** Border-radius is strictly `0px` across all tokens. Any rounding is a violation of the system's architectural integrity.
- **The Glass Inversion:** For floating overlays (like tooltips), use a semi-transparent `surface` color with a `backdrop-blur` of 8px, but maintain the 1px solid ink border.

---

## 5. Components

### Buttons
Buttons are the primary interaction drivers and must feel heavy and mechanical.
- **Primary:** `background: #111111; color: #F9F9F7; border: 1px solid #111111;`
- **Hover State:** `background: #168866; color: #FFFFFF; box-shadow: 4px 4px 0px 0px #111111; transform: translate(-2px, -2px);`
- **Secondary:** `background: transparent; color: #111111; border: 1px solid #111111;`

### Cards & Layout Containers
Cards are defined by their borders, not their backgrounds.
- **Style:** `0px` radius, `1px` solid `#111111` border. 
- **Padding:** Use `spacing-4` (0.9rem) for high density.
- **Nesting:** When nesting a card inside a section, the inner card should use a `1px` stroke of `#E5E5E0` to maintain hierarchy without visual clutter.

### Inputs & Forms
- **Field Style:** `0px` radius, `1px` solid `#111111`. 
- **Focus State:** Background shifts to `surface-container-lowest` (#FFFFFF) with a `primary` (#168866) 1px border.
- **Labels:** `label-md` in Uppercase, placed directly above the field with 0 margin, sharing a border-line with the input box.

### Data Chips
- **Selection Chips:** Square corners. When selected, the chip inverts (Black background, Off-white text). Use `label-sm` for the text.

---

## 6. Do's and Don'ts

### Do
- **Celebrate the Grid:** Align text to the 1px border lines. Let the structure show.
- **Embrace Density:** Use tight padding (`spacing-2` to `spacing-4`). AI workflows require seeing a lot of data at once.
- **Use Intentional Asymmetry:** If a layout feels too "balanced," shift a column by one grid unit to create an editorial, magazine-style feel.

### Don't
- **No Softness:** Never use `border-radius` or `box-shadow` blurs. It weakens the "Studio" authority.
- **No Flat Minimalism:** Avoid large areas of empty white space without a grid texture or a divider line; it makes the UI look "unfinished" rather than "minimal."
- **No 100% Opaque Colors for Accents:** Use the `primary` green sparingly. It is a highlighter, not a bucket-fill.

### Accessibility Note
While maintaining high density, ensure that all `on-surface` text on `surface` backgrounds maintains a contrast ratio of at least 7:1. The `outline-variant` (#E5E5E0) should only be used for decorative structural lines, never for essential text.