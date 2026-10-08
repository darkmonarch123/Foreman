import type { PlanId } from "@/lib/templates/catalog";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  email_verified: boolean;
  avatar_url: string;
  avatar_seed: string;
  avatar_style: string;
  avatar_gender_selection: "MALE" | "FEMALE";
  plan: PlanId;
  status: "ACTIVE" | "PENDING_DELETION" | "DELETED";
  notification_prefs: Record<string, boolean>;
  created_at: string;
}
