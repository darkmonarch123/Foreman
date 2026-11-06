import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

import { loadBoardPage } from "@/lib/boards/data";
import { queryLog, resetQueryLog } from "@/lib/perf/queries";

const BOARD = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mocks.rpc.mockReset();
  resetQueryLog();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

describe("board page data", () => {
  it("loads state and members in a single round trip (was two, one after the other)", async () => {
    mocks.rpc.mockResolvedValue({ data: { state: { board: {} }, members: [] }, error: null });
    expect(await loadBoardPage(BOARD)).toEqual({ state: { board: {} }, members: [] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("load_board_page", { p_board_id: BOARD });
    expect(queryLog().map((entry) => entry.name)).toEqual(["load_board_page"]);
  });

  it("treats a board the caller cannot see as missing, and never queries for a malformed id", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "BOARD_NOT_FOUND", code: "P0001" } });
    expect(await loadBoardPage(BOARD)).toBeNull();
    mocks.rpc.mockClear();
    expect(await loadBoardPage("not-a-board")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
