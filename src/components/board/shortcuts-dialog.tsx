"use client";

import { Modal } from "@/components/ui/modal";
import { shortcutList } from "@/lib/board/tools";

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = shortcutList(isMac());
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while you are typing in a text field."
      size="lg"
    >
      <div className="grid gap-8 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.group} className={group.group === "Tools" ? "sm:row-span-2" : undefined}>
            <h3 className="mb-3 text-sm font-medium">{group.group}</h3>
            <dl className="flex flex-col gap-2.5">
              {group.entries.map((entry) => (
                <div key={entry.action} className="flex items-start justify-between gap-4">
                  <dt className="text-sm text-ink/80">{entry.action}</dt>
                  <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                    {entry.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded-md border border-line bg-warm px-1.5 py-0.5 font-sans text-xs text-ink"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
