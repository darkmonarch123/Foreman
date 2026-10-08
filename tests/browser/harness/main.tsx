import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces/full.css";
import "./harness.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BoardWorkspace, type WorkspaceUser } from "@/components/board/board-workspace";
import { ToastProvider } from "@/components/ui/toast";
import type { BoardServices, Member } from "@/lib/board/services";
import type { BoardState } from "@/lib/board/types";
import { createHttpBoardServices } from "./http-services";

/**
 * Browser-test harness: mounts the real board workspace against the in-memory
 * test backend. Not part of the application bundle.
 *
 *   /?backend=http://127.0.0.1:PORT&user=ada|ben|vic
 */
const params = new URLSearchParams(window.location.search);
const backend = params.get("backend") ?? "";
const userKey = params.get("user") ?? "ada";

function Harness() {
  const [services] = useState<BoardServices>(() => createHttpBoardServices(backend, userKey));
  const [loaded, setLoaded] = useState<{ state: BoardState; members: Member[]; user: WorkspaceUser } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${backend}/rpc/state?user=${userKey}`, { method: "POST", body: "{}" });
        if (!response.ok) throw new Error("Board not found or access is unavailable.");
        const state = (await response.json()) as BoardState;
        const members = await services.loadMembers();
        const me = members.find((member) => member.username === userKey)!;
        if (!cancelled) {
          setLoaded({
            state,
            members,
            user: {
              id: me.user_id,
              first_name: me.first_name,
              last_name: me.last_name,
              username: me.username,
              avatar_url: me.avatar_url,
            },
          });
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [services]);

  if (error) return <p data-testid="harness-error">{error}</p>;
  if (!loaded) return <p data-testid="harness-loading">Loading</p>;
  return (
    <BoardWorkspace
      initial={loaded.state}
      initialMembers={loaded.members}
      currentUser={loaded.user}
      services={services}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <Harness />
    </ToastProvider>
  </StrictMode>,
);
