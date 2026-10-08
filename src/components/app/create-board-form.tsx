"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { BoardPreview } from "@/components/board/board-preview";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { createBoardAction } from "@/lib/boards/actions";
import { ACCESS_MODE_LABELS, ACCESS_MODES, createBoardSchema, type CreateBoardInput } from "@/lib/boards/schemas";
import type { TemplateRow } from "@/lib/boards/types";
import { cn } from "@/lib/cn";

export function CreateBoardForm({ template }: { template: TemplateRow | null }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateBoardInput>({
    resolver: zodResolver(createBoardSchema),
    defaultValues: { title: "", description: "", accessMode: "PRIVATE", templateSlug: template?.slug ?? null },
  });
  const accessMode = useWatch({ control, name: "accessMode" });

  async function onSubmit(values: CreateBoardInput) {
    setFormError(null);
    const result = await createBoardAction({ ...values, templateSlug: template?.slug ?? null });
    if (!result.ok) {
      if (result.fields) {
        for (const [field, message] of Object.entries(result.fields)) {
          setError(field as keyof CreateBoardInput, { message });
        }
      } else {
        setFormError(result.message);
      }
      return;
    }
    router.push(`/boards/${result.data.id}`);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
    >
      <div className="flex flex-col gap-6">
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Input
          label="Board name"
          placeholder="Foreman Launch Plan"
          maxLength={120}
          error={errors.title?.message}
          data-autofocus
          {...register("title")}
        />
        <Textarea
          label="Description (optional)"
          rows={3}
          maxLength={500}
          error={errors.description?.message}
          {...register("description")}
        />

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm font-medium">Who can access this board</legend>
          {ACCESS_MODES.map((mode) => (
            <label
              key={mode}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-control border bg-surface p-4 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                accessMode === mode ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" value={mode} className="mt-1 size-4 accent-black" {...register("accessMode")} />
              <span>
                <span className="block text-sm font-medium">{ACCESS_MODE_LABELS[mode].label}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                  {ACCESS_MODE_LABELS[mode].description}
                </span>
              </span>
            </label>
          ))}
          <p className="text-[13px] leading-snug text-muted">
            You can change this at any time. A link or code never gives anyone more than view access.
          </p>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={isSubmitting} loadingLabel="Creating board">
            Create board
          </Button>
          <Link
            href="/dashboard"
            className="inline-flex h-12 items-center rounded-control px-5 text-[15px] hover:bg-ink/6"
          >
            Cancel
          </Link>
        </div>
      </div>

      <aside aria-label="Starting point" className="flex flex-col gap-3">
        <p className="text-sm font-medium">Starting point</p>
        {template ? (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="canvas-grid aspect-[16/10] border-b border-line [background-size:16px_16px]">
              <BoardPreview
                objects={template.content}
                label={`Preview of the ${template.name} template`}
                padding={60}
                className="p-3"
              />
            </div>
            <div className="flex items-start justify-between gap-3 p-5">
              <div>
                <p className="font-display text-xl tracking-tight">{template.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{template.description}</p>
              </div>
              <Link
                href="/boards/new"
                aria-label="Remove template and start blank"
                title="Start blank instead"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-ink/6"
              >
                <X className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-line-strong p-8 text-center">
            <p className="font-display text-xl tracking-tight">Blank board</p>
            <p className="mt-1 text-sm text-muted">An empty canvas.</p>
            <Link href="/templates" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
              Choose a template instead
            </Link>
          </div>
        )}
      </aside>
    </form>
  );
}
