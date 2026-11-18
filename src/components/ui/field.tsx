import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-body text-ink aria-[invalid=true]:border-status-cancelled-fg";

/** Rótulo + controle + ajuda/erro, com aria-describedby ligado. */
export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-erro` : hint ? `${id}-ajuda` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-erro`} className="text-caption font-medium text-status-cancelled-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-ajuda`} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
  value,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  value?: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-5 shrink-0 accent-brand"
      />
      <span className="flex flex-col">
        <span className="text-body">{label}</span>
        {hint && <span className="text-caption text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function FormMessage({
  state,
}: {
  state: { ok: boolean; error?: string; message?: string } | null;
}) {
  if (!state) return null;
  if (state.ok) {
    return state.message ? (
      <p role="status" className="text-body font-medium text-status-confirmed-fg">
        {state.message}
      </p>
    ) : null;
  }
  return (
    <p
      role="alert"
      className="rounded-control bg-status-cancelled px-3 py-2 text-body font-medium text-status-cancelled-fg"
    >
      {state.error}
    </p>
  );
}

type Echoable = { ok: boolean; fields?: Record<string, string | string[]> } | null;
const fieldsOf = (s: Echoable) => (s && !s.ok ? s.fields : undefined);

/** Valor enviado no último envio com erro (para o formulário não voltar em branco). */
export function echo(state: Echoable, key: string): string | undefined {
  const v = fieldsOf(state)?.[key];
  return typeof v === "string" ? v : undefined;
}

export function echoAll(state: Echoable, key: string): string[] | undefined {
  const v = fieldsOf(state)?.[key];
  return Array.isArray(v) ? v : typeof v === "string" ? [v] : fieldsOf(state) ? [] : undefined;
}

/** Checkbox: desmarcado não é enviado, então "ausente" = falso quando houve envio. */
export function echoChecked(state: Echoable, key: string): boolean | undefined {
  const f = fieldsOf(state);
  return f ? f[key] === "on" : undefined;
}
