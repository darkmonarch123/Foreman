import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, isThemePreference, resolveTheme } from "@/lib/theme";

const css = readFileSync("src/app/globals.css", "utf8");

function block(selector: RegExp): Record<string, string> {
  const match = css.match(selector);
  if (!match) throw new Error(`block not found: ${selector}`);
  return Object.fromEntries([...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = block(/@theme \{([\s\S]*?)\n\}/);
const dark = block(/\n\[data-theme="dark"\] \{([\s\S]*?)\n\}/);
const systemDark = block(/:root:not\(\[data-theme\]\) \{([\s\S]*?)\n {2}\}/);

function hex(value: string): [number, number, number] {
  const m = value.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a 6-digit hex colour: ${value}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}
function luminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function token(theme: Record<string, string>, name: string): string {
  return theme[`--color-${name}`] ?? light[`--color-${name}`];
}

// Text-on-background pairs the components use. Each must meet WCAG AA for body text (4.5:1).
const TEXT_PAIRS: [string, string][] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "elevated"],
  ["muted", "canvas"],
  ["muted", "surface"],
  ["muted", "elevated"],
  ["on-accent", "accent"],
  ["accent-ink", "surface"],
  ["accent-ink", "accent-soft"],
  ["on-danger", "danger"],
  ["danger", "danger-soft"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
  ["danger", "surface"],
  ["canvas", "ink"],
];

describe("theme preference", () => {
  it("resolves System from the operating system and keeps explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
  });

  it("the pre-paint script only reads the theme key and writes the data-theme attributes", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).not.toMatch(/token|session|cookie|fetch/i);
    const root = { dataset: {} as Record<string, string> };
    const storage = new Map([[THEME_STORAGE_KEY, "dark"]]);
    new Function("localStorage", "matchMedia", "document", THEME_INIT_SCRIPT)(
      { getItem: (key: string) => storage.get(key) ?? null },
      () => ({ matches: false }),
      { documentElement: root },
    );
    expect(root.dataset).toEqual({ theme: "dark", themePreference: "dark" });
  });
});

describe("design tokens", () => {
  it("defines the same dark values for the explicit Dark theme and for System before scripts run", () => {
    expect(systemDark).toEqual(dark);
  });

  it("overrides only tokens that exist in the light theme", () => {
    for (const name of Object.keys(dark)) expect(light, name).toHaveProperty(name);
  });

  it("never uses pure black for dark surfaces", () => {
    for (const name of ["canvas", "sunken", "surface", "elevated", "board", "black"]) {
      expect(token(dark, name).toLowerCase(), name).not.toBe("#000000");
    }
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("text pairs meet WCAG AA contrast in the %s theme", (_name, theme) => {
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(contrast(token(theme, fg), token(theme, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("the focus ring and default board ink stand out in the %s theme", (_name, theme) => {
    expect(contrast(token(theme, "focus"), token(theme, "surface"))).toBeGreaterThanOrEqual(3);
  });
});

describe("board content in the dark theme", () => {
  it("inverts lightness of the content layer only, in both dark paths", () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.board-ink \{\s*filter: invert\(0\.9\) hue-rotate\(180deg\);/);
    expect(css).toMatch(/:root:not\(\[data-theme\]\) \.board-ink \{\s*filter: invert\(0\.9\) hue-rotate\(180deg\);/);
  });

  it("exports keep the stored colours", () => {
    const exporter = readFileSync("src/lib/board/export.ts", "utf8");
    expect(exporter).not.toMatch(/invert|board-ink|data-theme/);
  });
});
