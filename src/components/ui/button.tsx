import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
  "active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0 aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-black text-white hover:bg-[#2b2b2b] rounded-full",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong shadow-soft rounded-full",
  outline: "bg-transparent text-ink border border-ink/80 hover:bg-ink hover:text-white rounded-full",
  ghost: "bg-transparent text-ink hover:bg-ink/6 rounded-control",
  danger: "bg-error text-white hover:bg-[#a53125] rounded-full",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-[15px]",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text announced while loading; the visible label stays in place. */
  loadingLabel?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons have no visible text. */
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  size = "md",
  active,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control text-ink transition-colors duration-150",
        "hover:bg-ink/6 disabled:opacity-40",
        size === "sm" ? "size-8" : "size-10",
        active && "bg-ink text-white hover:bg-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function LinkButton({ variant = "primary", size = "md", className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClasses(variant, size, className)} {...rest} />;
}
