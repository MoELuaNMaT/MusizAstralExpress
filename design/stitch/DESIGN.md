```markdown
# Design System Strategy: The Tokyo Neon-Skeuo Aesthetic

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Hyper-Analog Sovereign."** 

We are not building a flat web interface; we are engineering a piece of high-end Japanese "Bubble Era" hardware that exists in a digital vapor-space. The goal is to evoke the tactile obsession of 1980s Tokyo—where brushed aluminum meets glowing vacuum fluorescent displays (VFDs). This design system breaks the modern "flat" template by utilizing extreme depth, intentional asymmetry, and "heavy" UI elements that feel like they have physical mass.

By layering glossy plastics against cold metals and electrified neon gases, we create a signature experience that feels premium, nostalgic, and aggressively intentional.

---

## 2. Colors & Materiality
This palette is divided into "Light-Emitting" neons and "Material" surfaces. 

### The "No-Line" Rule
Standard 1px borders are strictly prohibited. In this system, boundaries are defined by **physicality**. A button isn't a box with a border; it is a protrusion from the chassis. Use color shifts between `surface-container-low` and `surface-container-high` to define edges, or use "Light-Leaks" (1px highlights of `primary` at 40% opacity) on the top edges of elements to simulate a light source hitting a 3D bevel.

### Surface Hierarchy & Nesting
Treat the UI as a physical assembly.
*   **Chassis (`surface-container-lowest`):** The main body of the player.
*   **Sub-Panels (`surface-container-low`):** Recessed areas where buttons or dials reside.
*   **The Display Glass (`surface-container-highest`):** Use this for the VFD and LED areas.

### The "Glass & Gradient" Rule
To achieve the "Vaporwave" depth, use semi-transparent overlays of `secondary` and `primary` with a 20px-40px `backdrop-blur`. This simulates the thick acrylic covers found on high-end 80s audio gear. 

### Signature Textures
*   **Brushed Chrome:** Apply a subtle linear gradient across `surface-bright` using 5% noise to simulate aluminum.
*   **VFD Glow:** Any text using `tertiary` (#b1ffcd) should have a soft outer glow (using a 4px blur of `tertiary-container`) to simulate gas-discharge lighting.

---

## 3. Typography
The typography is a clash between high-tech precision and editorial elegance.

*   **Display (Space Grotesk):** Our "Instrument Typography." Used for track numbers, frequencies, and data. It should feel like it was etched into metal or printed on a circuit board.
*   **Headline & Title (Space Grotesk):** Bold, authoritative, and often paired with Japanese glyphs. Use `headline-lg` for impactful, asymmetrical headers that break the grid.
*   **Body & Labels (Plus Jakarta Sans):** The "User Manual" font. Clean, legible, and modern. Use `label-sm` for technical annotations (e.g., "60Hz", "STEREO", "DOLBY NR").

**Editorial Note:** Mix Japanese sans-serif characters with `display-md` monospace strings to create that authentic "Imported Electronics" look.

---

## 4. Elevation & Depth
In this system, depth is "Extreme Skeuomorphism."

### The Layering Principle
Do not use shadows to lift elements; use gradients to **extrude** them. 
- **Convex (Buttons):** Gradient from `surface-bright` (top-left) to `surface-dim` (bottom-right).
- **Concave (Inputs):** Gradient from `surface-dim` (top-left) to `surface-bright` (bottom-right).

### Ambient Shadows
For floating elements like "floating remote" modals, use a "Vapor-Shadow": A large 60px blur using a 15% opacity version of `inverse_on_surface` (#7b21c0). This makes the element feel like it's hovering over a neon-lit void.

### The "Ghost Border" Fallback
If contrast is needed for accessibility, use the `outline-variant` at 15% opacity, but offset it by 1px to create a "specular highlight" effect rather than a containing stroke.

---

## 5. Components

### Buttons (The "Tactile Switch")
*   **Primary:** Rectangular with a `0.25rem` radius. Use a `primary` to `primary-container` vertical gradient. Add a 1px `on-primary` highlight on the top edge.
*   **Secondary:** Brushed aluminum look. Use `surface-bright` with an inset shadow to make it look "pressed" when active.
*   **States:** On `hover`, the element should gain a `secondary` (Electric Blue) outer glow, simulating an internal LED turning on.

### The VFD Display (Cards & Lists)
*   **Container:** `surface-container-highest` with a subtle scanline overlay (1px horizontal lines at 5% opacity).
*   **Content:** No dividers. Use `surface-container-low` background blocks to group list items.
*   **Typography:** All text inside should use `tertiary` (Cyan) or `primary` (Neon Pink).

### Input Fields (The "Toggle Slot")
*   **Styling:** Deeply recessed into the `surface`. Use `surface-container-lowest` as the background.
*   **Active State:** The "cursor" is a blocky, blinking `secondary` (Electric Blue) rectangle.

### Additional Component: The VU Meter
*   A custom progress bar using a series of segmented blocks (using `secondary` for low levels, `tertiary` for mid, and `error` for "peak" levels). This is essential for the Japanese audio player aesthetic.

---

## 6. Do's and Don'ts

### Do:
*   **Use Asymmetry:** Place technical labels off-center. Overlap a glossy 3D sphere over a rigid grid background.
*   **Embrace the "Glow":** Treat `tertiary` and `secondary` as light sources that cast color onto neighboring "metal" surfaces.
*   **Reference the Grid:** Use a background grid of `outline-variant` at 5% opacity to ground the 3D elements.

### Don't:
*   **Don't use flat colors:** Every surface needs a subtle 2-degree gradient or a noise texture to feel "real."
*   **Don't use rounded corners over 12px:** The "Bubble Era" was about precision; keep radiuses tight (`md` or `sm`) to maintain a "machined" look.
*   **Don't use pure black:** Use `surface-container-lowest` (#000000) but always allow for a hint of `primary` or `secondary` "light leak" to prevent the UI from feeling "dead."

### Accessibility Note:
While we use extreme styling, ensure all "Light-Emitting" text (Cyan on Dark Purple) maintains a contrast ratio of at least 4.5:1. The glow should be an *effect*, not the source of legibility.