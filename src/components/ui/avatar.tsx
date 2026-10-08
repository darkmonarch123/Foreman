import { cn } from "@/lib/cn";

export interface AvatarPerson {
  user_id?: string;
  first_name: string;
  last_name: string;
  avatar_url: string;
}

const sizes = { xs: "size-6", sm: "size-8", md: "size-10", lg: "size-16", xl: "size-24" } as const;

export function personName(person: Pick<AvatarPerson, "first_name" | "last_name">): string {
  return `${person.first_name} ${person.last_name}`.trim();
}

/** Avatars are generated illustrations served from this app; see /api/avatar. */
function safeAvatarUrl(url: string): string | null {
  return /^\/api\/avatar\/(male|female)\/[a-z0-9]{8,32}$/.test(url) ? url : null;
}

interface AvatarProps {
  person: AvatarPerson;
  size?: keyof typeof sizes;
  /** Shows a presence dot with a text alternative. Omit when presence is unknown. */
  online?: boolean;
  className?: string;
  /** Decorative avatars sit next to the person's written name. */
  decorative?: boolean;
}

export function Avatar({ person, size = "sm", online, className, decorative }: AvatarProps) {
  const name = personName(person);
  const url = safeAvatarUrl(person.avatar_url);
  return (
    <span className={cn("relative inline-block shrink-0", sizes[size], className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- small generated SVGs; the image optimiser adds nothing
        <img
          src={url}
          alt={decorative ? "" : name}
          className="size-full rounded-full bg-line object-cover ring-2 ring-surface"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span
          role={decorative ? undefined : "img"}
          aria-label={decorative ? undefined : name}
          className="flex size-full items-center justify-center rounded-full bg-line text-xs font-medium text-muted ring-2 ring-surface"
        >
          {(person.first_name[0] ?? "?").toUpperCase()}
        </span>
      )}
      {online !== undefined ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface",
            online ? "bg-success" : "bg-line-strong",
          )}
        >
          <span className="sr-only">{online ? "Online" : "Offline"}</span>
        </span>
      ) : null}
    </span>
  );
}

interface AvatarStackProps {
  people: AvatarPerson[];
  /** Total people represented, when `people` is a truncated list. */
  total?: number;
  max?: number;
  size?: "xs" | "sm" | "md";
  className?: string;
}

export function AvatarStack({ people, total, max = 4, size = "sm", className }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const count = total ?? people.length;
  const extra = count - shown.length;
  if (shown.length === 0) return null;
  const names = shown.map(personName).join(", ");
  return (
    <span
      className={cn("inline-flex items-center", className)}
      role="group"
      aria-label={extra > 0 ? `${names} and ${extra} more` : names}
    >
      {shown.map((person, index) => (
        <Avatar
          key={person.user_id ?? `${person.avatar_url}-${index}`}
          person={person}
          size={size}
          decorative
          className={index > 0 ? "-ml-2" : undefined}
        />
      ))}
      {extra > 0 ? (
        <span
          aria-hidden
          className={cn(
            "-ml-2 inline-flex items-center justify-center rounded-full bg-warm text-[11px] font-medium text-muted ring-2 ring-surface",
            sizes[size],
          )}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
