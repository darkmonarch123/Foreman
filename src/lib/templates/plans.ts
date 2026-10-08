import type { PlanId } from "./catalog";

/**
 * Plan configuration.
 *
 * `templateCapacity` is an entitlement ceiling: the most templates a plan may
 * ever draw on. It is NOT the number of templates that exist. The library
 * currently contains the six starter templates in `catalog.ts`.
 *
 * There is no billing integration yet, so every account is on FREE and the
 * paid plans cannot be purchased.
 */
export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  templateCapacity: number;
  features: string[];
  purchasable: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "Free",
    tagline: "Everything you need to plan with a small group.",
    templateCapacity: 1_000,
    features: ["Core notes and boards", "Basic whiteboards", "Limited collaboration"],
    purchasable: true,
  },
  PLUS: {
    id: "PLUS",
    name: "Plus",
    tagline: "For teams that live on their boards.",
    templateCapacity: 10_000,
    features: ["Advanced templates", "Additional collaboration capabilities", "Export tools"],
    purchasable: false,
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    tagline: "For organisations that need the full library.",
    templateCapacity: 100_000,
    features: [
      "Full template library",
      "Advanced collaboration",
      "Version-history capability",
      "Priority capabilities",
    ],
    purchasable: false,
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "PLUS", "PRO"];

const RANK: Record<PlanId, number> = { FREE: 1, PLUS: 2, PRO: 3 };

/** Mirrors `private.plan_rank` in the database, which is what actually enforces entitlement. */
export function planAllows(userPlan: PlanId, requiredPlan: PlanId): boolean {
  return RANK[userPlan] >= RANK[requiredPlan];
}

export function formatCapacity(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
