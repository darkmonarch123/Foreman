"use client";

import { CircleCheck, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { downloadBlob, exportFileName, fullBoardBounds, renderBoardPng } from "@/lib/board/export";
import type { Bounds } from "@/lib/board/geometry";
import type { CanvasObject } from "@/lib/board/types";
import { cn } from "@/lib/cn";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  objects: CanvasObject[];
  /** The part of the board currently on screen, in world coordinates. */
  viewportBounds: Bounds;
  boardTitle: string;
  /** Records the export in the activity feed. Called only after a file was produced. */
  onExported: (scope: "board" | "viewport") => Promise<void>;
}

type Phase =
  { kind: "idle" } | { kind: "working" } | { kind: "done"; fileName: string } | { kind: "error"; message: string };

export function ExportDialog({ open, onClose, objects, viewportBounds, boardTitle, onExported }: ExportDialogProps) {
  const [scope, setScope] = useState<"board" | "viewport">("board");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const empty = objects.length === 0;

  async function run() {
    setPhase({ kind: "working" });
    try {
      const bounds = scope === "board" ? fullBoardBounds(objects) : viewportBounds;
      if (!bounds) throw new Error("There is nothing on the board to export yet.");
      const blob = await renderBoardPng(objects, bounds, 2);
      const fileName = exportFileName(boardTitle);
      downloadBlob(blob, fileName);
      setPhase({ kind: "done", fileName });
      // The file exists at this point; a failure to log it must not look like a failed export.
      void onExported(scope).catch(() => undefined);
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error && error.message ? error.message : "The image could not be created.",
      });
    }
  }

  function close() {
    setPhase({ kind: "idle" });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Export as PNG"
      description="The image contains the canvas only: no panels, member details, comments or other people’s cursors."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {phase.kind === "done" ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={run}
            loading={phase.kind === "working"}
            loadingLabel="Creating image"
            disabled={scope === "board" && empty}
          >
            <Download className="size-4" aria-hidden />
            {phase.kind === "done" ? "Export again" : "Export PNG"}
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2.5" disabled={phase.kind === "working"}>
        <legend className="mb-2.5 text-sm font-medium">What to include</legend>
        {(
          [
            { id: "board", label: "Whole board", description: "Everything on the canvas, with a margin." },
            { id: "viewport", label: "Current view", description: "Only the area you can see right now." },
          ] as const
        ).map((option) => (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-control border bg-surface p-3.5",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
              scope === option.id ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="export-scope"
              className="mt-1 size-4 accent-black"
              checked={scope === option.id}
              onChange={() => setScope(option.id)}
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-5" aria-live="polite">
        {scope === "board" && empty && phase.kind === "idle" ? (
          <Notice tone="info">This board is empty, so there is nothing to export yet.</Notice>
        ) : null}
        {phase.kind === "done" ? (
          <Notice tone="success">
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck className="size-4" aria-hidden />
              Saved as {phase.fileName}. Check your downloads.
            </span>
          </Notice>
        ) : null}
        {phase.kind === "error" ? <Notice tone="error">Export failed. {phase.message}</Notice> : null}
      </div>
    </Modal>
  );
}
