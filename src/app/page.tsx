import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { HeroPreview } from "@/components/landing/hero-preview";
import { LandingMotion } from "@/components/landing/landing-motion";
import { FOOTER_COLUMNS, LOGIN, NAV_LINKS, SIGNUP } from "@/components/landing/site-links";
import { STORY_LAYOUTS } from "@/components/landing/story-layouts";
import { TemplateGallery } from "@/components/landing/template-gallery";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { FeatureCard } from "@/components/ui/feature-card";
import { Footer } from "@/components/ui/footer";
import { Navbar } from "@/components/ui/navbar";
import { PricingCard } from "@/components/ui/pricing-card";
import { Section, SectionHeading } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import { TEMPLATE_CATALOG, TEMPLATE_CATEGORIES, categoryLabel } from "@/lib/templates/catalog";
import { PLAN_ORDER, PLANS, formatCapacity } from "@/lib/templates/plans";

export const metadata: Metadata = {
  title: { absolute: "Foreman — Plan visually. Build together." },
  description:
    "Foreman brings your team's ideas, tasks, and visual plans into one shared workspace: boards, sticky notes, diagrams and real-time collaboration.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Foreman — Plan visually. Build together.",
    description: "Bring your team's ideas, tasks, and visual plans into one shared workspace.",
    type: "website",
  },
};

export const viewport: Viewport = {
  // Draw under the notch and home indicator; the layout pads itself with the safe-area insets.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

const HEADLINE = "Your space for notes, plans, and big ideas";

const STATEMENT =
  "Most tools make you choose between thinking and doing. Foreman gives your ideas room to be messy, then helps you turn them into a plan the whole team can follow.";
const HIGHLIGHTED = new Set(["messy,", "plan"]);

function Aurora() {
  return (
    <div aria-hidden className="site-aurora">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

/** Feature icon. The colour is a class, so each has a lighter shade in Dark Mode. */
function Icon({ children, className }: { children: ReactNode; className: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
    >
      {children}
    </svg>
  );
}

const WAYS = [
  {
    title: "Boards",
    body: "A board for every project, with columns, frames and space to grow.",
    tone: "bg-site-plan",
    icon: (
      <Icon className="text-[#0071e3] dark:text-[#64a8ff]">
        <rect x="2.5" y="3" width="4.5" height="14" rx="1.5" />
        <rect x="9" y="3" width="4.5" height="9" rx="1.5" />
        <rect x="15.5" y="3" width="2" height="6" rx="1" />
      </Icon>
    ),
  },
  {
    title: "Tasks",
    body: "Cards you can write in seconds and move as the work moves.",
    tone: "bg-site-test",
    icon: (
      <Icon className="text-[#248a3d] dark:text-[#5fd37f]">
        <path d="M3 5.5l1.8 1.8L8 4M3 13l1.8 1.8L8 11.5M11 6h6M11 13.5h6" />
      </Icon>
    ),
  },
  {
    title: "Whiteboards",
    body: "Shapes, arrows and freehand drawing on a canvas that pans and zooms.",
    tone: "bg-site-build",
    icon: (
      <Icon className="text-[#5856d6] dark:text-[#a5a3ff]">
        <path d="M3 15c3-8 6 2 9-5s3-4 5-3" />
      </Icon>
    ),
  },
  {
    title: "Notes",
    body: "Sticky notes for the thought you don't want to lose.",
    tone: "bg-[#fff4e0] dark:bg-[#3a2a12]",
    icon: (
      <Icon className="text-[#c96a00] dark:text-[#ffb35c]">
        <path d="M5 3h7l3 3v11H5z M8 9h5M8 12.5h5" />
      </Icon>
    ),
  },
  {
    title: "Collaboration",
    body: "See who is here, where they are pointing, and what changed.",
    tone: "bg-[#fde8ef] dark:bg-[#3a1622]",
    icon: (
      <Icon className="text-[#d1305f] dark:text-[#ff7aa0]">
        <circle cx="7" cy="7.5" r="2.8" />
        <circle cx="14" cy="8.5" r="2.2" />
        <path d="M2.5 16c.8-3 2.6-4.5 4.5-4.5s3.7 1.5 4.5 4.5M12 12.5c2.5-.6 4.5.8 5.3 3.5" />
      </Icon>
    ),
  },
];

const STORY_STEPS = [
  {
    key: "01 · Capture",
    title: "Get every idea down.",
    body: "Sticky notes, text and freehand drawing, with no structure required yet.",
  },
  {
    key: "02 · Organize",
    title: "Group what belongs together.",
    body: "Drag notes into columns and the shape of the plan appears.",
  },
  {
    key: "03 · Commit",
    title: "Turn it into the plan.",
    body: "Pick the path, lay out the steps, and work through it with your team.",
  },
];

const STORY_NOTES = [
  ["A rough idea", "#fff3b0"],
  ["Another angle", "#ffd7e5"],
  ["Ask users", "#e8dcff"],
  ["The plan", "#c9e6ff"],
  ["First step", "#d5f2dc"],
  ["Second step", "#ffe2c6"],
];

/** A sticky note in the illustrations. Always pastel with dark text, in both modes, like the real thing. */
function Sticky({ children, color, style }: { children: ReactNode; color: string; style?: CSSProperties }) {
  return (
    <div
      className="rounded-[10px] p-3.5 text-site-small font-medium text-[#1d1d1f] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.18)] transition-transform duration-500 ease-site-spring hover:!rotate-0 hover:scale-105 motion-reduce:hover:scale-100"
      style={{ background: color, ...style }}
    >
      {children}
    </div>
  );
}

function Chip({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn(
        "rounded-full px-3.5 py-2 text-site-small font-medium transition-transform duration-500 ease-site-spring hover:-translate-y-0.5 hover:scale-105 motion-reduce:hover:transform-none",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

function Tile({
  kicker,
  title,
  children,
  art,
  className,
  dark,
  id,
  delay,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  art: ReactNode;
  className?: string;
  dark?: boolean;
  id?: string;
  delay?: number;
}) {
  return (
    <Card
      tone={dark ? "dark" : "muted"}
      size="lg"
      id={id}
      data-reveal
      data-surface={dark ? "dark" : undefined}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}
      className={cn(
        "flex min-h-[22.5rem] scroll-mt-24 flex-col overflow-hidden px-[1.625rem] pt-8 sm:min-h-[27.5rem] sm:px-10 sm:pt-11",
        className,
      )}
    >
      <p className={cn("mb-2 text-site-small font-semibold", dark ? "text-[#a1a1a6]" : "text-site-label-2")}>
        {kicker}
      </p>
      <h3 className="max-w-[20ch] text-site-h3">{title}</h3>
      <p className={cn("mt-3 max-w-[42ch]", dark ? "text-[#a1a1a6]" : "text-site-label-2")}>{children}</p>
      <div aria-hidden className="mt-auto pt-8">
        {art}
      </div>
    </Card>
  );
}

export default function LandingPage() {
  const templates = TEMPLATE_CATALOG.map((template) => ({
    slug: template.slug,
    name: template.name,
    description: template.description,
    category: template.category,
    categoryLabel: categoryLabel(template.category),
  }));

  return (
    <div className="site min-h-dvh">
      <Navbar links={NAV_LINKS} login={LOGIN} signup={SIGNUP} />

      <main id="main">
        {/* Hero */}
        <div className="relative overflow-clip pt-[calc(4.25rem+env(safe-area-inset-top))]">
          <Aurora />
          <Container>
            <section data-hero aria-labelledby="hero-title" className="relative z-[1] pb-16 pt-14 text-center sm:pt-24">
              <p className="mb-2.5 text-[1.1875rem] font-semibold tracking-[-0.02em] text-site-label-on-tint motion-safe:animate-site-rise">
                Foreman
              </p>
              <h1 id="hero-title" className="mx-auto max-w-[16ch] text-site-display text-balance">
                {HEADLINE.split(" ").map((word, index) => (
                  <span key={index}>
                    <span
                      className="inline-block motion-safe:animate-site-rise"
                      style={{ animationDelay: `${index * 55}ms` }}
                    >
                      {word}
                    </span>{" "}
                  </span>
                ))}
              </h1>
              <p
                className="mx-auto mt-5 max-w-[32ch] text-site-lede text-balance text-site-label-on-tint motion-safe:animate-site-rise"
                style={{ animationDelay: "500ms" }}
              >
                Bring your team’s ideas, tasks, and visual plans into one shared workspace.
              </p>
              <div
                className="mt-8 flex flex-wrap items-center justify-center gap-4 motion-safe:animate-site-rise"
                style={{ animationDelay: "650ms" }}
              >
                <LinkButton href={SIGNUP.href} variant="accent" size="xl">
                  Create your free workspace
                </LinkButton>
                <LinkButton href="/#templates" variant="glass" size="xl">
                  Explore templates
                </LinkButton>
              </div>
            </section>
            <div
              className="relative z-[1] pb-24 motion-safe:animate-site-rise sm:pb-30"
              style={{ animationDelay: "800ms" }}
            >
              <HeroPreview />
            </div>
          </Container>
        </div>

        {/* Statement */}
        <section aria-label="Why Foreman" className="bg-site-bg py-24 sm:py-statement">
          <Container>
            <p data-statement className="mx-auto max-w-[24ch] text-site-statement">
              {STATEMENT.split(" ").map((word, index) => (
                <span
                  key={index}
                  className={cn(
                    HIGHLIGHTED.has(word) &&
                      "bg-gradient-to-r from-[#0071e3] to-[#7a5af8] bg-clip-text text-transparent dark:from-[#2997ff] dark:to-[#a48bff]",
                  )}
                >
                  {word}{" "}
                </span>
              ))}
            </p>
          </Container>
        </section>

        {/* Five ways */}
        <Section id="product" tone="alt" aria-labelledby="product-title">
          <SectionHeading id="product-title" title="Five ways to work. One place to keep it all." />
          <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {WAYS.map((way, index) => (
              <li key={way.title} data-reveal style={{ "--reveal-delay": `${index * 70}ms` } as CSSProperties}>
                <FeatureCard icon={way.icon} iconClassName={way.tone} title={way.title} className="h-full">
                  {way.body}
                </FeatureCard>
              </li>
            ))}
          </ul>
        </Section>

        {/* How it works: a pinned story that plays as you scroll */}
        <section data-story aria-labelledby="story-title" className="relative h-[320vh] bg-site-bg">
          <div className="sticky top-0 flex h-dvh items-center">
            <Container className="grid items-center gap-6 pt-16 lg:grid-cols-[1fr_1.15fr] lg:gap-14 lg:pt-0">
              <div>
                <h2 id="story-title" className="mb-6 max-w-[14ch] text-site-h2 text-balance lg:mb-10">
                  From first thought to final form.
                </h2>
                <ol className="grid gap-3.5 lg:gap-8">
                  {STORY_STEPS.map((step, index) => (
                    <li key={step.key} data-step className={cn(index === 0 && "is-on")}>
                      <p className="mb-1.5 text-site-small font-semibold text-site-link">{step.key}</p>
                      <h3 className="text-[clamp(1.5rem,2.6vw,2rem)] font-bold leading-[1.12] tracking-[-0.03em]">
                        {step.title}
                      </h3>
                      <p className="mt-2 max-w-[34ch] text-site-label-2">{step.body}</p>
                    </li>
                  ))}
                </ol>
                <div aria-hidden className="mt-2 h-[3px] max-w-[17.5rem] overflow-hidden rounded-full bg-site-line">
                  <i data-story-bar className="block h-full w-full origin-left scale-x-0 bg-site-accent" />
                </div>
              </div>
              <div
                aria-hidden
                className="site-story-stage site-dots relative -order-1 h-[42dvh] overflow-hidden rounded-site-lg bg-site-surface shadow-site-lg lg:order-none lg:aspect-[1/0.9] lg:h-auto"
              >
                {["Ideas", "Research", "Plan"].map((label, index) => (
                  <span
                    key={label}
                    data-story-label
                    className="absolute top-[4%] text-[0.8125rem] font-semibold uppercase tracking-[0.05em] text-site-label-2 opacity-0"
                    style={{ left: `${4 + index * 32}%` }}
                  >
                    {label}
                  </span>
                ))}
                {STORY_NOTES.map(([text, color], index) => {
                  const [x, y, r, s, o, done] = STORY_LAYOUTS[0][index];
                  return (
                    <div
                      key={text}
                      data-note
                      className="site-story-note flex items-center justify-between gap-1.5 rounded-site-sm px-[3.6%] py-[3.2%] text-[clamp(0.7rem,1.2vw,0.9375rem)] font-medium text-[#1d1d1f] shadow-[0_8px_18px_-8px_rgb(0_0_0/0.25)]"
                      style={
                        {
                          background: color,
                          "--x": x,
                          "--y": y,
                          "--r": `${r}deg`,
                          "--s": s,
                          "--done": done,
                          opacity: o,
                        } as CSSProperties
                      }
                    >
                      {text}
                      <span
                        data-done
                        className="grid size-[18px] shrink-0 place-items-center rounded-full bg-[#248a3d]"
                      >
                        <svg viewBox="0 0 12 12" className="size-[11px]">
                          <path
                            d="M3 6.2l2 2 4-4.4"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Container>
          </div>
        </section>

        {/* Features */}
        <Section aria-labelledby="features-title">
          <SectionHeading
            id="features-title"
            title="Everything you need. Nothing you don’t."
            subtitle="Start with loose notes. Finish with a plan the whole team can follow."
          />
          <div className="mt-16 grid gap-5 lg:grid-cols-6">
            <Tile
              kicker="Whiteboards"
              title="Sketch the rough idea. Shape it into the plan."
              className="lg:col-span-4"
              art={
                <div className="flex flex-wrap items-end gap-3.5 pb-9">
                  <Sticky color="#fff3b0" style={{ transform: "rotate(-3deg)" }}>
                    A rough idea
                  </Sticky>
                  <Sticky color="#ffd7e5" style={{ transform: "rotate(2deg)" }}>
                    Another angle
                  </Sticky>
                  <div className="h-0.5 min-w-5 flex-1 self-center bg-site-line-strong" />
                  <Sticky color="#c9e6ff">The plan</Sticky>
                  <Sticky color="#d5f2dc">First step</Sticky>
                </div>
              }
            >
              Sticky notes, text, shapes, arrows and freehand drawing, with undo, redo and PNG export.
            </Tile>
            <Tile
              kicker="Boards"
              title="Planning that doesn’t feel like work."
              className="lg:col-span-2"
              delay={80}
              art={
                <div className="flex flex-wrap gap-2 pb-10">
                  <Chip className="bg-site-plan">Plan</Chip>
                  <Chip className="bg-site-plan">Scope</Chip>
                  <Chip className="bg-site-build">Build</Chip>
                  <Chip className="bg-site-build">In progress</Chip>
                  <Chip className="bg-site-test">Test</Chip>
                  <Chip className="bg-site-test">Review</Chip>
                </div>
              }
            >
              Readable columns, shared state and a live activity feed.
            </Tile>
            <Tile
              kicker="Canvas"
              title="Structure that adapts to your thinking."
              className="lg:col-span-3"
              art={
                <div className="flex flex-wrap gap-2 pb-10">
                  <Chip className="bg-site-label text-site-bg">Topic</Chip>
                  {["Notes", "Risks", "Tasks", "Links"].map((label) => (
                    <Chip key={label} className="border border-site-line-strong bg-site-surface">
                      {label}
                    </Chip>
                  ))}
                </div>
              }
            >
              Roadmaps, mind maps and system diagrams on one canvas you can pan and zoom, with a board outline for
              keyboard and screen-reader use.
            </Tile>
            <Tile
              kicker="Personalize"
              title="Make it unmistakably yours."
              className="lg:col-span-3"
              delay={80}
              art={
                <div className="flex flex-wrap gap-2 pb-10">
                  <Chip className="bg-[#c4224a] text-white">Your colours</Chip>
                  <Chip className="bg-[#b35a00] text-[1.1rem] text-white">Any size</Chip>
                  <Chip className="!rounded-md bg-[#1f7a3a] text-white">Your shapes</Chip>
                  <Chip className="bg-[#4b49c8] text-white">Your words</Chip>
                </div>
              }
            >
              A considered palette for notes and shapes. Resize, restyle and rewrite anything, rename boards and
              regenerate your avatar whenever you like.
            </Tile>
            <Tile
              id="collaboration"
              dark
              kicker="Collaboration"
              title="Build together, in real time."
              className="lg:col-span-6"
              art={
                <div className="grid items-end gap-6 sm:grid-cols-2">
                  <div className="relative h-[10.625rem]">
                    {[
                      ["Ada", "#ff9f0a", "8%", "20%", "0s"],
                      ["Kemi", "#30b0c7", "48%", "48%", "-2.5s"],
                      ["Tolu", "#bf5af2", "22%", "66%", "-5s"],
                    ].map(([name, color, left, top, delay]) => (
                      <div
                        key={name}
                        className="site-cursor absolute flex items-start gap-0.5 text-site-caption font-semibold text-[#1d1d1f]"
                        style={{ left, top, animationDelay: delay }}
                      >
                        <svg viewBox="0 0 16 16" className="size-4">
                          <path d="M2 1l11 6-5 1.5L6 14z" fill={color} />
                        </svg>
                        <span className="mt-3 rounded-full px-2 py-0.5" style={{ background: color }}>
                          {name}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2.5 pb-10">
                    {[
                      ["Owner", "Full control"],
                      ["Editor", "Can change"],
                      ["Viewer", "Can look"],
                    ].map(([role, ability]) => (
                      <div
                        key={role}
                        className="min-w-[5.625rem] flex-1 rounded-site-sm bg-white/[0.08] p-3.5 text-site-small"
                      >
                        <b className="mb-0.5 block text-base text-white">{role}</b>
                        {ability}
                      </div>
                    ))}
                  </div>
                </div>
              }
            >
              Everyone edits the same board at the same time. Invite editors and viewers, share a link or a code, leave
              comments, and see who’s here.
            </Tile>
          </div>
        </Section>

        {/* Templates (also the use cases: each one is a way of working) */}
        <Section id="templates" tone="alt" aria-labelledby="templates-title" backdrop={<Aurora />}>
          <div id="use-cases" className="scroll-mt-24" />
          <SectionHeading
            id="templates-title"
            onTint
            title="Start from a template."
            subtitle="Six starting points, ready the moment you are."
          />
          <TemplateGallery templates={templates} categories={TEMPLATE_CATEGORIES} />
          <p className="mt-12 text-center">
            <Link href="/templates" className="site-link-arrow min-h-11 text-site-body">
              Browse all templates
            </Link>
          </p>
        </Section>

        {/* Pricing */}
        <Section id="pricing" aria-labelledby="pricing-title">
          <SectionHeading
            id="pricing-title"
            title="Free to start. Room to grow."
            subtitle="Foreman is free to use today. Plus and Pro describe where the product is going; they can’t be purchased yet."
          />
          <div className="mt-16 grid gap-5 lg:grid-cols-3">
            {PLAN_ORDER.map((id, index) => {
              const plan = PLANS[id];
              return (
                <div key={plan.id} data-reveal style={{ "--reveal-delay": `${index * 80}ms` } as CSSProperties}>
                  <PricingCard
                    name={plan.name}
                    price={plan.purchasable ? "$0" : "—"}
                    priceNote={plan.purchasable ? "forever" : undefined}
                    status={plan.purchasable ? "Available now" : "Coming soon"}
                    featured={plan.purchasable}
                    description={plan.tagline}
                    features={[
                      `Template access up to ${formatCapacity(plan.templateCapacity)} templates`,
                      ...plan.features,
                    ]}
                    className="h-full"
                    action={
                      plan.purchasable ? (
                        <LinkButton href={SIGNUP.href} variant="accent" size="xl" className="w-full">
                          Create your free workspace
                        </LinkButton>
                      ) : (
                        <p className="flex min-h-[3.25rem] items-center justify-center rounded-full bg-site-line text-site-body text-site-label-2">
                          Not available yet
                        </p>
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
          <p className="mx-auto mt-7 max-w-[60ch] text-center text-[0.8125rem] text-site-label-2">
            Template numbers are capacity limits for each plan, not a count of templates that exist. The library
            currently holds the six starter templates shown above.
          </p>
        </Section>

        {/* Closing call to action */}
        <section
          id="about"
          aria-labelledby="cta-title"
          className="relative scroll-mt-24 overflow-clip bg-site-bg-alt py-28 text-center sm:py-40"
        >
          <Aurora />
          <Container className="relative">
            <h2 id="cta-title" data-cta-title className="mx-auto max-w-[12ch] text-site-display text-balance">
              Plan visually. Build together.
            </h2>
            <div data-reveal className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <LinkButton href={SIGNUP.href} variant="accent" size="xl">
                Create your free workspace
              </LinkButton>
              <LinkButton href={LOGIN.href} variant="glass" size="xl">
                I already have an account
              </LinkButton>
            </div>
          </Container>
        </section>
      </main>

      <Footer
        summary="Foreman is a visual workspace for notes, boards, whiteboards and real-time collaboration."
        columns={FOOTER_COLUMNS}
        legal="Copyright © 2026 Foreman. All rights reserved."
        aside="Built with Next.js and Supabase."
      />
      <LandingMotion />
    </div>
  );
}
