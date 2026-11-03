// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkMock } from "../support/next-mocks";

vi.mock("next/link", () => ({ default: LinkMock }));

import LandingPage, { metadata, viewport } from "@/app/page";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";

/** jsdom has no layout, observers or media queries; give the page harmless stand-ins. */
let reduceMotion = false;
beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") ? reduceMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  document.elementsFromPoint = () => [];
  Element.prototype.animate = vi.fn() as unknown as Element["animate"];
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  reduceMotion = false;
});

const renderPage = () => render(<LandingPage />);

describe("landing page structure", () => {
  it("has one h1 with the headline, and header, navigation, main and footer landmarks", () => {
    renderPage();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Your space for notes, plans, and big ideas");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders every section of the design, in order", () => {
    renderPage();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    const expected = [
      "Five ways to work. One place to keep it all.",
      "From first thought to final form.",
      "Everything you need. Nothing you don’t.",
      "Start from a template.",
      "Free to start. Room to grow.",
      "Plan visually. Build together.",
    ];
    const positions = expected.map((text) => headings.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(screen.getByRole("figure")).toHaveTextContent("Project Roadmap");
    expect(screen.getByRole("region", { name: "Why Foreman" })).toHaveTextContent(
      "Most tools make you choose between thinking and doing.",
    );
  });

  it("keeps every in-page anchor the rest of the site links to", () => {
    const { container } = renderPage();
    for (const id of ["main", "product", "collaboration", "templates", "use-cases", "pricing", "about"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  it("keeps the existing SEO metadata, and colours the browser chrome for light and dark", () => {
    expect(metadata.title).toEqual({ absolute: "Foreman — Plan visually. Build together." });
    expect(metadata.description).toMatch(/one shared workspace/);
    expect(viewport.viewportFit).toBe("cover");
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
      { media: "(prefers-color-scheme: dark)", color: "#000000" },
    ]);
  });
});

describe("links and calls to action", () => {
  it("points the navigation at the same routes as before", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Product", "/#product"],
      ["Templates", "/#templates"],
      ["Collaboration", "/#collaboration"],
      ["Pricing", "/#pricing"],
    ]);
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(within(banner).getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
    expect(within(banner).getByRole("link", { name: "Foreman home" })).toHaveAttribute("href", "/");
  });

  it("sends every sign-up call to action to /register and the secondary ones to the right places", () => {
    renderPage();
    const signups = screen.getAllByRole("link", { name: "Create your free workspace" });
    expect(signups.length).toBe(3); // hero, pricing, closing
    for (const link of signups) expect(link).toHaveAttribute("href", "/register");
    expect(screen.getByRole("link", { name: "Explore templates" })).toHaveAttribute("href", "/#templates");
    expect(screen.getByRole("link", { name: "I already have an account" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Browse all templates" })).toHaveAttribute("href", "/templates");
  });

  it("links every template to creating a board from it, with a descriptive name", () => {
    renderPage();
    for (const template of TEMPLATE_CATALOG) {
      expect(screen.getByRole("link", { name: `Use template: ${template.name}` })).toHaveAttribute(
        "href",
        `/boards/new?template=${template.slug}`,
      );
    }
  });

  it("keeps the footer's routes", () => {
    renderPage();
    const footer = screen.getByRole("contentinfo");
    const hrefs = within(footer)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    for (const href of ["/privacy", "/cookies", "/terms", "/join", "/login", "/register", "/#use-cases", "/#about"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("offers sign-up only on the plan that can be chosen today", () => {
    renderPage();
    const pricing = document.getElementById("pricing")!;
    expect(within(pricing).getAllByRole("link", { name: "Create your free workspace" })).toHaveLength(1);
    expect(within(pricing).getAllByText("Not available yet")).toHaveLength(2);
    expect(within(pricing).getByText("Available now")).toBeInTheDocument();
    expect(within(pricing).getAllByText("Coming soon")).toHaveLength(2);
  });
});

describe("mobile navigation", () => {
  it("opens and closes from the menu button, and closes with Escape returning focus", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Close menu");
    expect(panel).toBeVisible();
    const menu = within(panel).getByRole("navigation", { name: "Menu" });
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Product", "Templates", "Collaboration", "Pricing", "Log in"]);

    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("closes when a menu link is followed", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = screen.getByRole("button", { name: "Open menu" });
    await user.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    await user.click(within(panel).getByRole("link", { name: "Pricing" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("template filter", () => {
  it("is a labelled group of toggle buttons that filters the templates", async () => {
    const user = userEvent.setup();
    renderPage();
    const group = screen.getByRole("group", { name: "Filter templates by category" });
    const all = within(group).getByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: "Engineering" }));
    expect(within(group).getByRole("button", { name: "Engineering" })).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    const links = screen.getAllByRole("link", { name: /^Use template: / }).map((link) => link.textContent);
    expect(links).toEqual(["Use template: Sprint Retrospective", "Use template: System Design Canvas"]);
    expect(screen.getByText("Showing 2 Engineering templates")).toBeInTheDocument();

    await user.click(all);
    expect(screen.getAllByRole("link", { name: /^Use template: / })).toHaveLength(TEMPLATE_CATALOG.length);
  });
});

describe("motion", () => {
  it("marks the page once its motion script runs; the CSS that dims content is gated on that mark", () => {
    const { container } = renderPage();
    expect(container.querySelector<HTMLElement>(".site")!.dataset.motion).toBe("on");
  });

  it("marks the page as reduced-motion when the person asks for it", () => {
    reduceMotion = true;
    const { container } = renderPage();
    expect(container.querySelector<HTMLElement>(".site")!.dataset.motion).toBe("reduced");
  });
});
