/**
 * The starter template catalog.
 *
 * This file is the single source of truth for template content. The seed
 * migration `supabase/migrations/20261008000800_seed_templates.sql` is
 * generated from it (`npm run db:generate-templates`) and a unit test fails
 * if the two drift apart.
 *
 * Template text is deliberately generic and reads as a prompt to edit it. It
 * is sample content, never attributed to a person.
 */
import type { CanvasObjectType, CanvasProps } from "@/lib/board/types";

export type TemplateCategory = "PLANNING" | "BRAINSTORMING" | "STUDY" | "PRODUCT" | "ENGINEERING";
export type PlanId = "FREE" | "PLUS" | "PRO";

export interface TemplateObject {
  type: CanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  props: CanvasProps;
}

export interface TemplateDefinition {
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  minPlan: PlanId;
  featured: boolean;
  sortOrder: number;
  content: TemplateObject[];
}

const INK = "#121212";
const BORDER = "#E9E5DF";
const SKY = "#A8D8F0";
const LAVENDER = "#AEB9F4";
const MINT = "#A8DDB2";
const YELLOW = "#F8DD72";
const CORAL = "#F3A5A0";
const TINT = {
  sky: "#E6F3FA",
  lavender: "#E9ECFC",
  mint: "#E6F5E9",
  yellow: "#FDF5D4",
  coral: "#FBE6E4",
  paper: "#FFFFFF",
};

function title(text: string, x: number, y: number, width = 640): TemplateObject {
  return { type: "TEXT", x, y, width, height: 48, props: { text, fontSize: 32, bold: true, color: INK } };
}

function label(text: string, x: number, y: number, width = 240, fontSize = 20): TemplateObject {
  return { type: "TEXT", x, y, width, height: 32, props: { text, fontSize, bold: true, color: INK } };
}

function body(text: string, x: number, y: number, width = 320): TemplateObject {
  return { type: "TEXT", x, y, width, height: 28, props: { text, fontSize: 15, color: "#666666" } };
}

function panel(x: number, y: number, width: number, height: number, fill: string): TemplateObject {
  return { type: "RECTANGLE", x, y, width, height, props: { fill, stroke: BORDER, strokeWidth: 1 } };
}

function note(text: string, x: number, y: number, fill = YELLOW, width = 252, height = 96): TemplateObject {
  return { type: "STICKY_NOTE", x, y, width, height, props: { text, fill, fontSize: 15, color: INK } };
}

function arrow(x: number, y: number, dx: number, dy: number): TemplateObject {
  return { type: "ARROW", x, y, width: dx, height: dy, props: { stroke: INK, strokeWidth: 2 } };
}

function circle(text: string, x: number, y: number, size: number, fill: string): TemplateObject {
  return {
    type: "CIRCLE",
    x,
    y,
    width: size,
    height: size,
    props: { text, fill, stroke: BORDER, strokeWidth: 1, fontSize: 16, bold: true, color: INK },
  };
}

/** A titled column with stacked sample notes. */
function column(
  heading: string,
  x: number,
  fill: string,
  notes: string[],
  noteFill: string,
  height = 560,
): TemplateObject[] {
  return [
    panel(x, 0, 300, height, fill),
    label(heading, x + 24, 22, 252),
    ...notes.map((text, index) => note(text, x + 24, 76 + index * 112, noteFill)),
  ];
}

const projectRoadmap: TemplateDefinition = {
  slug: "project-roadmap",
  name: "Project Roadmap",
  description: "Lay out a project in three stages — Plan, Build and Test — and move work across as it progresses.",
  category: "PLANNING",
  minPlan: "FREE",
  featured: true,
  sortOrder: 10,
  content: [
    title("Project Roadmap", 0, -120),
    body("Sample layout. Replace the example cards with your own work.", 0, -64, 640),
    ...column("Plan", 0, TINT.sky, ["Example: define the goal", "Example: list milestones"], SKY),
    ...column("Build", 340, TINT.lavender, ["Example: first deliverable"], LAVENDER),
    ...column("Test", 680, TINT.mint, ["Example: review and feedback"], MINT),
    arrow(304, 38, 32, 0),
    arrow(644, 38, 32, 0),
  ],
};

const brainstorm: TemplateDefinition = {
  slug: "brainstorming-session",
  name: "Brainstorming Session",
  description: "Start from a central question, collect ideas around it, then group the ones worth pursuing.",
  category: "BRAINSTORMING",
  minPlan: "FREE",
  featured: true,
  sortOrder: 20,
  content: [
    title("Brainstorming Session", 0, -120),
    body("Sample layout. Write your question in the centre and add ideas around it.", 0, -64, 640),
    circle("Your question", 360, 170, 220, YELLOW),
    note("Example idea", 40, 40, CORAL, 220, 110),
    note("Example idea", 40, 210, SKY, 220, 110),
    note("Example idea", 40, 380, MINT, 220, 110),
    note("Example idea", 680, 40, LAVENDER, 220, 110),
    note("Example idea", 680, 210, YELLOW, 220, 110),
    note("Example idea", 680, 380, CORAL, 220, 110),
    arrow(356, 250, -92, -120),
    arrow(356, 280, -92, -14),
    arrow(356, 310, -92, 110),
    arrow(584, 250, 92, -120),
    arrow(584, 280, 92, -14),
    arrow(584, 310, 92, 110),
    panel(0, 560, 940, 180, TINT.paper),
    label("Worth pursuing", 24, 580, 300),
    body("Drag the strongest ideas here.", 24, 616, 400),
  ],
};

const userStoryMap: TemplateDefinition = {
  slug: "user-story-map",
  name: "User Story Map",
  description: "Map what people do, step by step, and slice the stories underneath into releases.",
  category: "PRODUCT",
  minPlan: "FREE",
  featured: false,
  sortOrder: 30,
  content: [
    title("User Story Map", 0, -120),
    body("Sample layout. Activities run left to right; stories stack beneath each one.", 0, -64, 720),
    label("Activities", -160, 28, 140, 16),
    label("Release 1", -160, 168, 140, 16),
    label("Release 2", -160, 308, 140, 16),
    ...["Discover", "Sign up", "First use", "Return"].flatMap((step, index) => [
      note(`Example activity: ${step}`, index * 280, 0, LAVENDER, 252, 96),
      note("Example story", index * 280, 140, YELLOW, 252, 96),
      note("Example story", index * 280, 280, TINT.yellow, 252, 96),
    ]),
    arrow(-160, 124, 1260, 0),
    arrow(-160, 264, 1260, 0),
  ],
};

const retrospective: TemplateDefinition = {
  slug: "sprint-retrospective",
  name: "Sprint Retrospective",
  description: "Look back on a sprint together: what went well, what did not, and what to try next.",
  category: "ENGINEERING",
  minPlan: "FREE",
  featured: true,
  sortOrder: 40,
  content: [
    title("Sprint Retrospective", 0, -120),
    body("Sample layout. Add one note per thought, then agree on actions.", 0, -64, 640),
    ...column("Went well", 0, TINT.mint, ["Example: something that worked"], MINT, 480),
    ...column("To improve", 340, TINT.coral, ["Example: something that slowed us down"], CORAL, 480),
    ...column("Ideas", 680, TINT.sky, ["Example: something to try"], SKY, 480),
    ...column("Actions", 1020, TINT.yellow, ["Example: an action and who owns it"], YELLOW, 480),
  ],
};

const systemDesign: TemplateDefinition = {
  slug: "system-design-canvas",
  name: "System Design Canvas",
  description: "Sketch the parts of a system and how requests flow between them.",
  category: "ENGINEERING",
  minPlan: "FREE",
  featured: false,
  sortOrder: 50,
  content: [
    title("System Design Canvas", 0, -120),
    body("Sample layout. Rename the boxes and redraw the arrows for your system.", 0, -64, 720),
    panel(0, 100, 200, 110, TINT.sky),
    label("Client", 24, 140, 152),
    panel(300, 100, 200, 110, TINT.lavender),
    label("Application", 324, 140, 152),
    panel(600, 0, 200, 110, TINT.mint),
    label("Database", 624, 40, 152),
    panel(600, 200, 200, 110, TINT.yellow),
    label("Realtime", 624, 240, 152),
    arrow(204, 155, 92, 0),
    arrow(504, 135, 92, -70),
    arrow(504, 175, 92, 70),
    panel(0, 380, 380, 200, TINT.paper),
    label("Requirements", 24, 400, 300),
    note("Example: what must it do?", 24, 448, YELLOW, 332, 96),
    panel(420, 380, 380, 200, TINT.paper),
    label("Open questions", 444, 400, 300),
    note("Example: what is still undecided?", 444, 448, CORAL, 332, 96),
  ],
};

const studyPlanner: TemplateDefinition = {
  slug: "study-planner",
  name: "Study Planner",
  description: "Plan a week of study: topics to cover, sessions for each day, and what to review.",
  category: "STUDY",
  minPlan: "FREE",
  featured: false,
  sortOrder: 60,
  content: [
    title("Study Planner", 0, -120),
    body("Sample layout. Fill in your topics and spread sessions across the week.", 0, -64, 720),
    panel(0, 0, 280, 520, TINT.lavender),
    label("Topics", 24, 22, 232),
    note("Example topic", 24, 76, LAVENDER, 232, 88),
    note("Example topic", 24, 180, LAVENDER, 232, 88),
    ...["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap((day, index) => [
      panel(320 + index * 190, 0, 170, 320, TINT.sky),
      label(day, 336 + index * 190, 22, 138),
      note("Example session", 336 + index * 190, 76, index % 2 === 0 ? SKY : YELLOW, 138, 88),
    ]),
    panel(320, 360, 930, 160, TINT.mint),
    label("Review at the end of the week", 344, 380, 500),
    body("What stuck, and what needs another pass?", 344, 416, 500),
  ],
};

export const TEMPLATE_CATALOG: TemplateDefinition[] = [
  projectRoadmap,
  brainstorm,
  userStoryMap,
  retrospective,
  systemDesign,
  studyPlanner,
];

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "PLANNING", label: "Planning" },
  { id: "BRAINSTORMING", label: "Brainstorming" },
  { id: "STUDY", label: "Study" },
  { id: "PRODUCT", label: "Product" },
  { id: "ENGINEERING", label: "Engineering" },
];

export function categoryLabel(category: TemplateCategory): string {
  return TEMPLATE_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Builds the seed migration. Idempotent: re-running updates rows in place. */
export function buildTemplateSeedSql(catalog: TemplateDefinition[] = TEMPLATE_CATALOG): string {
  const rows = catalog
    .map(
      (template) =>
        `  (${[
          sqlString(template.slug),
          sqlString(template.name),
          sqlString(template.description),
          sqlString(template.category),
          sqlString(template.minPlan),
          String(template.featured),
          String(template.sortOrder),
          `${sqlString(JSON.stringify(template.content))}::jsonb`,
        ].join(", ")})`,
    )
    .join(",\n");

  return `-- Foreman — starter template catalog.
-- GENERATED from src/lib/templates/catalog.ts by \`npm run db:generate-templates\`.
-- Do not edit by hand.

insert into public.templates (slug, name, description, category, min_plan, is_featured, sort_order, content)
values
${rows}
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  min_plan = excluded.min_plan,
  is_featured = excluded.is_featured,
  sort_order = excluded.sort_order,
  content = excluded.content;
`;
}
