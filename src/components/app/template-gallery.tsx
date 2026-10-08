"use client";

import Link from "next/link";
import { useState } from "react";
import { BoardPreview } from "@/components/board/board-preview";
import { TemplateCard } from "@/components/template-card";
import { Pill } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { TemplateRow } from "@/lib/boards/types";
import { categoryLabel, type PlanId } from "@/lib/templates/catalog";
import { PLANS, planAllows } from "@/lib/templates/plans";

/** Template cards with a preview dialog. Filtering and paging happen on the server. */
export function TemplateGallery({ templates, plan }: { templates: TemplateRow[]; plan: PlanId }) {
  const [previewing, setPreviewing] = useState<TemplateRow | null>(null);
  const previewAllowed = previewing ? planAllows(plan, previewing.min_plan) : false;

  return (
    <>
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => {
          const allowed = planAllows(plan, template.min_plan);
          return (
            <li key={template.id}>
              <TemplateCard
                className="h-full"
                name={template.name}
                description={template.description}
                category={categoryLabel(template.category)}
                content={template.content}
                featured={template.is_featured}
                lockedPlan={allowed ? undefined : PLANS[template.min_plan].name}
                action={
                  <div className="flex flex-wrap gap-2">
                    {allowed ? (
                      <LinkButton href={`/boards/new?template=${template.slug}`} size="sm">
                        Use this template
                      </LinkButton>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => setPreviewing(template)}>
                      Preview
                    </Button>
                  </div>
                }
              />
            </li>
          );
        })}
      </ul>

      <Modal
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        title={previewing?.name ?? ""}
        description={previewing?.description}
        size="xl"
        footer={
          previewing ? (
            <>
              <Button variant="ghost" onClick={() => setPreviewing(null)}>
                Close
              </Button>
              {previewAllowed ? (
                <LinkButton href={`/boards/new?template=${previewing.slug}`}>Use this template</LinkButton>
              ) : (
                <span className="text-sm text-muted">
                  Included in the {PLANS[previewing.min_plan].name} plan, which isn’t available yet.{" "}
                  <Link href="/#pricing" className="underline underline-offset-2">
                    See plans
                  </Link>
                </span>
              )}
            </>
          ) : null
        }
      >
        {previewing ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Pill>{categoryLabel(previewing.category)}</Pill>
              <Pill>{previewing.content.length} items</Pill>
            </div>
            <div className="canvas-grid aspect-[16/9] rounded-card border border-line [background-size:18px_18px]">
              <BoardPreview
                objects={previewing.content}
                label={`Preview of the ${previewing.name} template`}
                padding={60}
              />
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              Everything on a template is sample content. It opens as an ordinary board that you can edit or clear.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
