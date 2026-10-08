import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "@/lib/board/types";
import { TEMPLATE_CATALOG, buildTemplateSeedSql } from "@/lib/templates/catalog";

const SEED_PATH = join(__dirname, "..", "..", "supabase", "migrations", "20261008000800_seed_templates.sql");

describe("template catalog", () => {
  it("matches the generated seed migration", () => {
    const sql = buildTemplateSeedSql();
    if (process.env.UPDATE_TEMPLATE_SEED === "1") {
      writeFileSync(SEED_PATH, sql);
    }
    expect(readFileSync(SEED_PATH, "utf8")).toBe(sql);
  });

  it("contains the six starter templates with unique slugs", () => {
    expect(TEMPLATE_CATALOG.map((template) => template.name)).toEqual([
      "Project Roadmap",
      "Brainstorming Session",
      "User Story Map",
      "Sprint Retrospective",
      "System Design Canvas",
      "Study Planner",
    ]);
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.slug)).size).toBe(TEMPLATE_CATALOG.length);
  });

  it("gives Project Roadmap its Plan, Build and Test columns", () => {
    const roadmap = TEMPLATE_CATALOG.find((template) => template.slug === "project-roadmap");
    const labels = roadmap?.content.filter((object) => object.type === "TEXT").map((object) => object.props.text);
    expect(labels).toEqual(expect.arrayContaining(["Plan", "Build", "Test"]));
  });

  it("only uses supported object types and sane geometry", () => {
    for (const template of TEMPLATE_CATALOG) {
      for (const object of template.content) {
        expect(OBJECT_TYPES).toContain(object.type);
        expect(Number.isFinite(object.x) && Number.isFinite(object.y)).toBe(true);
        if (object.type !== "ARROW") {
          expect(object.width).toBeGreaterThan(0);
          expect(object.height).toBeGreaterThan(0);
        }
      }
    }
  });
});
