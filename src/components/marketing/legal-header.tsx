import { Notice } from "@/components/ui/notice";

export function LegalHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <header className="mb-10">
      <h1 className="font-display text-headline">{title}</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">{summary}</p>
      <Notice tone="info" className="mt-6">
        This page describes how the Foreman software behaves. It is not legal advice and has not been reviewed by a
        lawyer. Whoever operates a Foreman deployment is responsible for adding their identity, contact details and any
        terms their jurisdiction requires.
      </Notice>
    </header>
  );
}
