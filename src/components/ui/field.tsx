"use client";

import { Eye, EyeOff } from "lucide-react";
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

const controlClasses =
  "w-full rounded-control border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 " +
  "transition-[border-color,box-shadow] duration-150 " +
  "focus:outline-none focus-visible:outline-none focus:border-focus focus:ring-3 focus:ring-focus/20 " +
  "disabled:bg-warm disabled:text-muted";

function borderFor(error?: string) {
  return error ? "border-error focus:border-error focus:ring-error/20" : "border-line hover:border-line-strong";
}

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({ id, label, hint, error, children, className }: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] leading-snug text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ label, hint, error, wrapperClassName, className, id: idProp, ref, ...rest }: InputProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, "h-11", borderFor(error), className)}
        {...rest}
      />
    </FieldShell>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordInput({
  label,
  hint,
  error,
  wrapperClassName,
  className,
  id: idProp,
  ref,
  ...rest
}: InputProps) {
  const generated = useId();
  const id = idProp ?? generated;
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlClasses, "h-11 pr-12", borderFor(error), className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-ink/6 hover:text-ink"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </FieldShell>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ label, hint, error, wrapperClassName, className, id: idProp, ref, ...rest }: TextareaProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, "min-h-24 resize-y py-2.5 leading-relaxed", borderFor(error), className)}
        {...rest}
      />
    </FieldShell>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
  /** Visually hide the label (it stays available to assistive technology). */
  hideLabel?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({
  label,
  hint,
  error,
  wrapperClassName,
  className,
  hideLabel,
  id: idProp,
  children,
  ref,
  ...rest
}: SelectProps) {
  const generated = useId();
  const id = idProp ?? generated;
  const select = (
    <select
      ref={ref}
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      className={cn(
        controlClasses,
        "h-11 appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9",
        "bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23666%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')]",
        borderFor(error),
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
  if (hideLabel) return select;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={wrapperClassName}>
      {select}
    </FieldShell>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  error?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Checkbox({ label, error, className, id: idProp, ref, ...rest }: CheckboxProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 size-[18px] shrink-0 rounded-[5px] border border-line-strong accent-black"
          {...rest}
        />
        <label htmlFor={id} className="text-sm leading-snug text-ink">
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="pl-7 text-[13px] text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** An on/off switch. Announced as a switch; state is also shown as text-free position plus label. */
export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </p>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-[13px] leading-snug text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-50",
          checked ? "border-black bg-black" : "border-line-strong bg-line",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 size-[18px] -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-150",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
