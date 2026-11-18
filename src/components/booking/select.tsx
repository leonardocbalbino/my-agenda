"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { SlotButton, type SlotState } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Parâmetros que dependem de outros: trocar o serviço zera o horário, etc. */
export type ParamChanges = Record<string, string | null>;

function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const navigate = (changes: ParamChanges) => {
    const next = new URLSearchParams(params);
    next.delete("erro");
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };
  /** `before` roda dentro da mesma transição (ex.: atualização otimista). */
  const set = (changes: ParamChanges, before?: () => void) =>
    startTransition(() => {
      before?.();
      navigate(changes);
    });
  return { set, pending };
}

/** Botão de escolha (serviço, profissional, dia, quadra) que grava a escolha na URL. */
export function SelectButton({
  changes,
  pressed,
  className,
  children,
  label,
}: {
  changes: ParamChanges;
  pressed: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const { set, pending } = useSetParams();
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      aria-busy={pending || undefined}
      onClick={() => set(changes)}
      className={cn(className, pending && "opacity-70")}
    >
      {children}
    </button>
  );
}

export function SlotSelect({
  time,
  state,
  changes,
  layout = "grid",
  price,
}: {
  time: string;
  state: SlotState;
  changes: ParamChanges;
  layout?: "grid" | "row";
  price?: string;
}) {
  const { set } = useSetParams();
  const onClick = state === "taken" ? undefined : () => set(changes);
  return layout === "row" ? (
    <SlotButton layout="row" time={time} state={state} price={price} onClick={onClick} />
  ) : (
    <SlotButton time={time} state={state} onClick={onClick} />
  );
}

export function RecurringToggle({
  checked,
  title,
  hint,
}: {
  checked: boolean;
  title: string;
  hint: string;
}) {
  const { set } = useSetParams();
  // Marca na hora; o servidor confirma quando a página volta com o novo preço.
  const [optimistic, setOptimistic] = useOptimistic(checked);
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-card border border-border bg-surface px-5 py-4">
      <span className="flex flex-col">
        <span className="text-body-lg font-semibold">{title}</span>
        <span className="text-body text-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={optimistic}
        onChange={(e) => {
          const value = e.target.checked;
          set({ mensal: value ? "1" : null }, () => setOptimistic(value));
        }}
        className="size-6 shrink-0 accent-brand"
      />
    </label>
  );
}
