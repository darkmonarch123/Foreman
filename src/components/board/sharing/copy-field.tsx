"use client";

import { Check, Copy } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { copyText } from "./use-async";

interface CopyFieldProps {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}

/** A read-only value with a Copy button that confirms in text, not only by icon. */
export function CopyField({ label, value, mono, hint }: CopyFieldProps) {
  const id = useId();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const ok = await copyText(value);
    setCopied(ok ? "copied" : "failed");
    setTimeout(() => setCopied("idle"), 2500);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(
            "h-10 min-w-0 flex-1 rounded-control border border-line bg-warm px-3 text-sm",
            mono && "font-mono tracking-[0.14em]",
          )}
        />
        <Button variant="secondary" onClick={copy} className="shrink-0">
          {copied === "copied" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          <span aria-live="polite">
            {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
          </span>
        </Button>
      </div>
      {hint ? <p className="text-[13px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
