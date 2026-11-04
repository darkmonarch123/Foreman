import { describe, expect, it } from "vitest";
import { isAssistantEnabled } from "@/lib/assistant/flag";

describe("assistant_enabled feature flag", () => {
  it("is off by default in production", () => {
    expect(isAssistantEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isAssistantEnabled({ NODE_ENV: "production", ASSISTANT_ENABLED: "" })).toBe(false);
    expect(isAssistantEnabled({ NODE_ENV: "production", ASSISTANT_ENABLED: "maybe" })).toBe(false);
  });

  it("is on by default in development and tests", () => {
    expect(isAssistantEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isAssistantEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("can be switched on in production", () => {
    for (const value of ["true", "TRUE", " 1 "]) {
      expect(isAssistantEnabled({ NODE_ENV: "production", ASSISTANT_ENABLED: value })).toBe(true);
    }
  });

  it("can be switched off anywhere", () => {
    for (const value of ["false", "FALSE", "0"]) {
      expect(isAssistantEnabled({ NODE_ENV: "development", ASSISTANT_ENABLED: value })).toBe(false);
    }
  });

  it("ships on in render.yaml", async () => {
    const { readFileSync } = await import("node:fs");
    const yaml = readFileSync("render.yaml", "utf8");
    expect(yaml).toMatch(/key: ASSISTANT_ENABLED\s+value: "true"/);
  });
});
