"use client";

import { useMemo } from "react";
import type { Member } from "@/lib/board/services";
import { createSupabaseBoardServices } from "@/lib/board/supabase-services";
import type { BoardState } from "@/lib/board/types";
import { getBrowserClient } from "@/lib/supabase/client";
import { BoardWorkspace, type WorkspaceUser } from "./board-workspace";

interface BoardClientProps {
  initial: BoardState;
  initialMembers: Member[];
  currentUser: WorkspaceUser;
}

/** Wires the board UI to Supabase. Everything below this component is backend-agnostic. */
export function BoardClient({ initial, initialMembers, currentUser }: BoardClientProps) {
  const services = useMemo(
    () => createSupabaseBoardServices(getBrowserClient(), initial.board.id, currentUser.id),
    [initial.board.id, currentUser.id],
  );
  return (
    <BoardWorkspace initial={initial} initialMembers={initialMembers} currentUser={currentUser} services={services} />
  );
}
