# Foreman Assistant v1.1 and v1.2

What changed after v1.0 (see [architecture](architecture.md#foreman-assistant) for the v1 design). The safety model
is unchanged: the Assistant is a deterministic rule engine on the application server; it sends nothing to any
other service; every change is a proposal to add one note, applied only when the person accepts it through
`assistant_accept_proposal`, which re-checks permission and every object version in one transaction.

## v1.1

### Ranking

```
usefulness = confidence × severityWeight × actionabilityWeight × freshnessWeight × templateRelevanceWeight
```

| Factor        | Values                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| severity      | high 1.0 · warning 0.85 · info 0.7                                                                                                                                                                   |
| actionability | proposes a change 1.0 · report only 0.8                                                                                                                                                              |
| freshness     | newest evidence edited ≤ 1 day 1.0 · ≤ 7 days 0.9 · ≤ 30 days 0.8 · older 0.7 · unknown 0.9                                                                                                          |
| template      | 0.6–1.0 by template category (a brainstorm cares less about owners), times the person's own votes on that kind of finding on this board: +10% per helpful, −15% per not helpful, kept within 0.4–1.2 |

The result is capped at 1. Before scoring, findings are:

- **suppressed**: kinds the person hid on this board, and findings (same rule and same items) they marked not helpful;
- **merged**: two findings about exactly the same items become one card, keeping the more useful and mentioning the other;
- **combined**: three or more report-only findings of one kind become one card with their evidence (up to 10 items).

Code: `src/lib/assistant/rank.ts`. Each stored finding keeps its `usefulness` and a `fingerprint` (rule id and
sorted object ids, never text).

### Showing findings

The panel shows the five most useful findings, with **Show more findings** for the rest (up to ten). Each has a
confidence band with a short explanation:

| Band     | Confidence | Meaning                                                               |
| -------- | ---------- | --------------------------------------------------------------------- |
| Clear    | 0.85–1.0   | Shown directly by the board, like an empty note or overlapping items. |
| Likely   | 0.65–0.84  | Strongly suggested by the wording or layout, but worth a quick check. |
| Possible | 0.50–0.64  | A pattern worth a look. It may be fine as it is.                      |

### Feedback

On every finding: **Helpful** / **Not helpful**, optional reasons (Irrelevant, Duplicate, Wrong evidence, Too
obvious, Wrong suggested action) and **Hide this type of finding on this board**.

- Stored per person, board, rule and finding (`assistant_feedback`, one row per person per finding); hidden kinds in
  `assistant_hidden_rules`. Both private by RLS: each person reads only their own.
- Changeable and removable (press the same button again). Hidden kinds can be shown again from the panel.
- Every change is audited in the append-only `assistant_feedback_events`.
- Only the person who ran the analysis can give feedback on its findings; viewers can give feedback too.
- Feedback changes ranking for the next run. It never applies, edits or removes anything on the board.

### Template-aware context

```ts
interface AssistantTemplateContext {
  templateId: string; // template slug
  category: "PLANNING" | "BRAINSTORMING" | "STUDY" | "PRODUCT" | "ENGINEERING";
  outcome: string; // e.g. "agreed actions, each with an owner"
  expectedSections: string[]; // the template's section headings
}
```

Built from the board's template (returned by the snapshot in the same round trip) and the template catalog. It sets
the template relevance weights and is shown as "Tuned for this board's template".

## v1.2

### Focus follow-up

After a run: **What should Assistant focus on?** Decisions · Owners · Risks · Next steps · Everything. Choosing one
re-runs the same analysis keeping only the matching kinds of finding.

### Action extraction

| Note says                      | Proposed note                                  | Confidence  |
| ------------------------------ | ---------------------------------------------- | ----------- |
| "We need to decide pricing"    | `Decide: Pricing approach`                     | 0.80 Likely |
| "Alice will handle onboarding" | `Owner: Alice — Onboarding`                    | 0.90 Clear  |
| "This might break checkout"    | `Risk: Checkout regression`                    | 0.70 Likely |
| "Investigate slow dashboard"   | `Next step: Investigate dashboard performance` | 0.65 Likely |

An owner is suggested **only** when a note names a person and commits them ("will handle", "is leading", "@sam
owns", "owner: Alice"). It is never inferred from who wrote a note, who is nearby, or from "we", "someone" or "the
team", and never from uncertain wording ("might handle"). Code: `src/lib/assistant/extract.ts`.

### Planning clarity

A 0–100 score with strengths, gaps and what would improve it (at most three suggestions). Parts and weights:
decisions 25, owners 25, next steps 20, clear notes 15, structure 15. Parts that do not apply (no questions, no
actions, a single note) are left out and the rest scaled up. It counts only; it never quotes note text.
Code: `src/lib/assistant/clarity.ts`.

## Migrations

- `20261104000300_assistant_v1_1.sql`: usefulness and fingerprint columns; feedback, hidden rules and feedback
  audit tables with RLS; `assistant_set_feedback`, `assistant_clear_feedback`, `assistant_set_rule_hidden`,
  `assistant_hidden_rules_for`; the snapshot adds `updated_at`, the template and the caller's feedback summary.
- `20261104000400_assistant_v1_2.sql`: allows the four extraction rule ids.
