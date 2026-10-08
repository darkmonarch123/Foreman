import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { FakeBackend } from "./fake-backend";

interface BackendState {
  objects: {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    deleted: boolean;
    version: number;
    props: Record<string, unknown>;
  }[];
  lastSequence: number;
  log: { type: string; actor_id: string; sequence: number }[];
  activity: string[];
  comments: string[];
}

export interface BoardFixtures {
  backend: FakeBackend;
  /** Opens the board as one of the seeded members: ada (owner), ben (editor), vic (viewer). */
  openBoard: (user: "ada" | "ben" | "vic", options?: { context?: BrowserContext }) => Promise<Page>;
  control: (action: string, body?: Record<string, unknown>) => Promise<unknown>;
  serverState: () => Promise<BackendState>;
}

export const test = base.extend<BoardFixtures, { sharedBackend: FakeBackend }>({
  sharedBackend: [
    async ({}, provide) => {
      const backend = new FakeBackend();
      await backend.start();
      await provide(backend);
      await backend.stop();
    },
    { scope: "worker" },
  ],
  backend: async ({ sharedBackend }, provide) => {
    sharedBackend.reset({ template: true });
    await provide(sharedBackend);
  },
  control: async ({ backend, request }, provide) => {
    await provide(async (action, body = {}) => {
      const response = await request.post(`http://127.0.0.1:${backend.port}/__test/${action}`, { data: body });
      return response.json();
    });
  },
  serverState: async ({ control }, provide) => {
    await provide(async () => (await control("state")) as BackendState);
  },
  openBoard: async ({ backend, context }, provide) => {
    const pages: Page[] = [];
    await provide(async (user, options = {}) => {
      const page = await (options.context ?? context).newPage();
      pages.push(page);
      await page.goto(`/?backend=${encodeURIComponent(`http://127.0.0.1:${backend.port}`)}&user=${user}`);
      await expect(page.getByTestId("canvas-stage")).toBeVisible();
      // The connection indicator turns to "Connected" once the realtime channel is up.
      await expect(page.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
      return page;
    });
    for (const page of pages) await page.close().catch(() => undefined);
  },
});

export { expect };

/** Centre of an object on screen, found by its text. */
export async function objectCentre(page: Page, text: string): Promise<{ x: number; y: number }> {
  const box = await page.locator("[data-object-id]").filter({ hasText: text }).first().boundingBox();
  if (!box) throw new Error(`No object with text "${text}"`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function canvasBox(page: Page) {
  const box = await page.getByTestId("canvas-stage").boundingBox();
  if (!box) throw new Error("Canvas not found");
  return box;
}

/** Double-clicks an object by its text (the text layer itself does not take pointer events). */
export async function doubleClickObject(page: Page, text: string): Promise<void> {
  const centre = await objectCentre(page, text);
  await page.mouse.dblclick(centre.x, centre.y);
}
