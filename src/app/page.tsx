import { Check, MousePointer2 } from "lucide-react";
import Link from "next/link";
import { BoardPreview, type PreviewObject } from "@/components/board/board-preview";
import { ObjectShape } from "@/components/board/object-shape";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import {
  categoryVignettes,
  planning,
  structure,
  thoughtToForm,
  together,
  yours,
} from "@/components/marketing/vignettes";
import { TemplateCard } from "@/components/template-card";
import { LinkButton } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { contentBounds } from "@/lib/board/geometry";
import { cn } from "@/lib/cn";
import { TEMPLATE_CATALOG, categoryLabel } from "@/lib/templates/catalog";
import { PLAN_ORDER, PLANS, formatCapacity } from "@/lib/templates/plans";

const roadmap = TEMPLATE_CATALOG.find((template) => template.slug === "project-roadmap")!;

/** The hero illustration: the real Project Roadmap template, with one note on its way from Plan to Build. */
function HeroBoard() {
  // Everything except the heading block, plus one extra note that travels.
  const objects = roadmap.content.filter((object) => object.y >= 0 || object.type === "ARROW");
  const bounds = contentBounds(objects, 36)!;
  const travelling: PreviewObject = {
    type: "STICKY_NOTE",
    x: 24,
    y: 300,
    width: 252,
    height: 96,
    props: { text: "Example: draft the launch checklist", fill: "#F8DD72", fontSize: 15, color: "#121212" },
  };

  return (
    <div className="relative overflow-hidden rounded-panel border border-line bg-surface shadow-lift">
      <div className="flex h-12 items-center justify-between border-b border-line px-5">
        <div className="flex items-center gap-4">
          <Wordmark className="text-sm" />
          <span className="hidden text-sm text-muted sm:inline">Project Roadmap</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
          <Check className="size-3.5" aria-hidden />
          Saved
        </span>
      </div>
      <div className="canvas-grid [background-size:22px_22px]">
        <svg
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
          className="block w-full"
          role="img"
          aria-label="A Foreman board with Plan, Build and Test columns. A sticky note is being moved from Plan into Build."
        >
          {objects.map((object, index) => (
            <ObjectShape key={index} object={object} />
          ))}
          <g className="hero-note">
            <ObjectShape object={travelling} />
            <g transform="translate(236 372)">
              <path
                d="M0 0l0 22 6-6 5 11 4-2-5-11 8 0z"
                fill="#121212"
                stroke="#fff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

const categories = [
  { name: "Boards", body: "A board for every project, with columns, frames and space to grow.", tone: "bg-sky-tint" },
  { name: "Tasks", body: "Cards you can write in seconds and move as the work moves.", tone: "bg-mint-tint" },
  {
    name: "Whiteboards",
    body: "Shapes, arrows and freehand drawing on a canvas that pans and zooms.",
    tone: "bg-lavender-tint",
  },
  { name: "Notes", body: "Sticky notes for the thought you don't want to lose.", tone: "bg-yellow-tint" },
  { name: "Collaboration", body: "See who is here, where they are pointing, and what changed.", tone: "bg-coral-tint" },
];

const useCases = [
  {
    name: "Planning",
    body: "Break a goal into stages and watch it move from plan to done.",
    template: "project-roadmap",
  },
  { name: "Study", body: "Lay out a week of topics and sessions, then review what stuck.", template: "study-planner" },
  {
    name: "Software projects",
    body: "Sketch a system, map user stories, and run the retro afterwards.",
    template: "system-design-canvas",
  },
  {
    name: "Workshops",
    body: "Collect everyone's ideas around one question and group the best.",
    template: "brainstorming-session",
  },
  {
    name: "Team coordination",
    body: "One shared picture of who is doing what, kept current by the people doing it.",
    template: "sprint-retrospective",
  },
];

interface StoryProps {
  id?: string;
  title: string;
  body: string;
  points: string[];
  visual: PreviewObject[];
  visualLabel: string;
  tone: string;
  flip?: boolean;
}

function Story({ id, title, body, points, visual, visualLabel, tone, flip }: StoryProps) {
  return (
    <section id={id} className="scroll-mt-28 px-3 sm:px-6">
      <div
        className={cn(
          "mx-auto grid max-w-6xl items-center gap-10 rounded-panel p-6 sm:p-10 lg:grid-cols-2 lg:gap-16 lg:p-16",
          tone,
        )}
      >
        <div className={cn(flip && "lg:order-2")}>
          <h2 className="font-display text-headline">{title}</h2>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink/75">{body}</p>
          <ul className="mt-7 flex flex-col gap-3">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] leading-snug">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                  <Check className="size-3" aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className={cn("rounded-card bg-surface/80 p-5 shadow-soft sm:p-8", flip && "lg:order-1")}>
          <BoardPreview objects={visual} label={visualLabel} padding={24} />
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      <SiteNav />
      <main id="main" className="flex flex-col gap-24 pb-8 sm:gap-32">
        {/* Hero */}
        <section className="px-6 pt-16 sm:pt-24">
          <div className="mx-auto max-w-6xl">
            <h1 className="font-display max-w-4xl text-display">Your space for notes, plans, and big ideas</h1>
            <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <p className="max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
                Foreman brings your team’s ideas, tasks, and visual plans into one shared workspace.
              </p>
              <div className="flex flex-wrap gap-3">
                <LinkButton href="/register" size="lg">
                  Create your free workspace
                </LinkButton>
                <LinkButton href="/#templates" size="lg" variant="secondary">
                  Explore templates
                </LinkButton>
              </div>
            </div>
            <div className="mt-14 sm:mt-20">
              <HeroBoard />
            </div>
          </div>
        </section>

        {/* Feature categories */}
        <section id="product" className="scroll-mt-28 px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display max-w-2xl text-headline">Five ways to work, one canvas</h2>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {categories.map((category) => (
                <li key={category.name} className={cn("flex flex-col rounded-card p-5", category.tone)}>
                  <div className="h-28">
                    <BoardPreview objects={categoryVignettes[category.name]} simplified padding={10} />
                  </div>
                  <h3 className="font-display mt-5 text-2xl tracking-tight">{category.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink/70">{category.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className="scroll-mt-28 px-6">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
            <div>
              <h2 className="font-display text-headline">Made for the work you already do</h2>
              <p className="mt-5 max-w-sm text-[17px] leading-relaxed text-muted">
                Each of these starts from a template you can open, change and make your own.
              </p>
            </div>
            <ul className="divide-y divide-line border-y border-line">
              {useCases.map((useCase) => (
                <li key={useCase.name}>
                  <Link
                    href={`/boards/new?template=${useCase.template}`}
                    className="group grid gap-1 py-6 sm:grid-cols-[14rem_1fr] sm:items-baseline sm:gap-6"
                  >
                    <span className="font-display text-2xl tracking-tight underline-offset-4 group-hover:underline">
                      {useCase.name}
                    </span>
                    <span className="text-[15px] leading-relaxed text-muted">{useCase.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Product stories */}
        <div className="flex flex-col gap-6">
          <Story
            title="From first thought to final form"
            body="Start with loose notes. Drag them together, draw the connections, and a plan takes shape on the same canvas."
            points={[
              "Sticky notes, text, shapes, arrows and freehand drawing",
              "Undo and redo your own changes",
              "Export the finished board as a PNG",
            ]}
            visual={thoughtToForm}
            visualLabel="Two loose sticky notes with arrows leading into an organised plan."
            tone="bg-yellow-tint"
          />
          <Story
            title="Planning that doesn’t feel like work"
            body="Columns you can read at a glance, and cards that move with one drag. Everyone sees the same state of the plan."
            points={[
              "Start from the Project Roadmap template",
              "Move a card and it is saved straight away",
              "An activity feed records what actually happened",
            ]}
            visual={planning}
            visualLabel="Three columns named Plan, Build and Test with cards in each."
            tone="bg-sky-tint"
            flip
          />
          <Story
            title="Structure that adapts to your thinking"
            body="A roadmap, a mind map, a system diagram or all three on one board. The canvas takes whatever shape the problem has."
            points={[
              "A large canvas that pans and zooms",
              "Six starter templates across planning, study, product and engineering",
              "A board outline lists everything for keyboard and screen-reader use",
            ]}
            visual={structure}
            visualLabel="A central topic connected by arrows to notes, tasks, risks and links."
            tone="bg-lavender-tint"
          />
          <Story
            title="Make it unmistakably yours"
            body="Colour, size, wording and layout are yours to set. Template content is only a starting point."
            points={[
              "A considered palette for notes and shapes",
              "Resize, restyle and rewrite anything",
              "Rename boards and regenerate your avatar whenever you like",
            ]}
            visual={yours}
            visualLabel="Sticky notes and shapes in different colours and sizes, with a freehand underline."
            tone="bg-coral-tint"
            flip
          />
          <Story
            id="collaboration"
            title="Build together, in real time"
            body="Invite people as editors or viewers. You see who is on the board, where their cursor is, and their changes as they make them."
            points={[
              "Roles enforced by the database: owner, editor and viewer",
              "Invitations, share links and collaboration codes that the owner controls",
              "Comments and presence from real, signed-in people only",
            ]}
            visual={together}
            visualLabel="A shared board with three notes connected in sequence."
            tone="bg-mint-tint"
          />
        </div>

        {/* Templates */}
        <section id="templates" className="scroll-mt-28 px-6">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-headline">Start from a template</h2>
                <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted">
                  Six starter templates are available today. Every one opens as an ordinary board you can edit freely.
                </p>
              </div>
              <LinkButton href="/templates" variant="outline">
                Browse all templates
              </LinkButton>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATE_CATALOG.map((template) => (
                <TemplateCard
                  key={template.slug}
                  name={template.name}
                  description={template.description}
                  category={categoryLabel(template.category)}
                  content={template.content}
                  featured={template.featured}
                  action={
                    <Link
                      href={`/boards/new?template=${template.slug}`}
                      className="text-sm font-medium underline underline-offset-4 hover:no-underline"
                    >
                      Use {template.name}
                    </Link>
                  }
                />
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-28 px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-headline">Plans</h2>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted">
              Foreman is free to use today. Plus and Pro describe where the product is going; they cannot be purchased
              yet.
            </p>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {PLAN_ORDER.map((id) => {
                const plan = PLANS[id];
                return (
                  <article
                    key={plan.id}
                    className={cn(
                      "flex flex-col rounded-card border p-7",
                      plan.purchasable ? "border-ink bg-surface shadow-soft" : "border-line bg-surface/60",
                    )}
                  >
                    <h3 className="font-display text-3xl tracking-tight">{plan.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{plan.tagline}</p>
                    <ul className="mt-6 flex flex-1 flex-col gap-3 text-[15px]">
                      <li className="flex items-start gap-3">
                        <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                        Template access up to {formatCapacity(plan.templateCapacity)} templates
                      </li>
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-3">
                          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-8">
                      {plan.purchasable ? (
                        <LinkButton href="/register" className="w-full">
                          Create your free workspace
                        </LinkButton>
                      ) : (
                        <p className="rounded-full border border-dashed border-line-strong px-5 py-2.5 text-center text-sm text-muted">
                          Not available yet
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-muted">
              Template numbers are capacity limits for each plan, not a count of templates that exist. The library
              currently holds the six starter templates shown above.
            </p>
          </div>
        </section>

        {/* Final CTA */}
        <section id="about" className="scroll-mt-28 px-3 sm:px-6">
          <div className="mx-auto max-w-6xl rounded-panel bg-black px-6 py-16 text-white sm:px-16 sm:py-24">
            <h2 className="font-display max-w-3xl text-headline">Plan visually. Build together.</h2>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/70">
              Open a board, add a note, and invite the people you are building with. It takes about a minute.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <LinkButton href="/register" size="lg" variant="secondary">
                Create your free workspace
              </LinkButton>
              <Link href="/login" className="text-[15px] text-white/80 underline underline-offset-4 hover:text-white">
                I already have an account
              </Link>
            </div>
            <p className="mt-12 flex items-center gap-2 text-[13px] text-white/50">
              <MousePointer2 className="size-3.5" aria-hidden />
              Foreman is a real-time collaborative visual workspace built with Next.js, Supabase and
              WebSocket-compatible realtime communication.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
