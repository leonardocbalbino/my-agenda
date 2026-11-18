import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SlotState = "free" | "selected" | "taken";

interface CommonProps extends Omit<ComponentProps<"button">, "children" | "aria-pressed"> {
  state: SlotState;
}

/** Botão de horário em grade (barbearia/salão): "09:30". */
export interface SlotGridProps extends CommonProps {
  layout?: "grid";
  /** Horário já formatado no fuso da Location, ex. "09:30". */
  time: string;
}

/** Linha de horário (arena): "20:00 – 21:00 ........ R$ 220" ou "Reservado". */
export interface SlotRowProps extends CommonProps {
  layout: "row";
  time: string;
  /** Preço já formatado; ignorado quando `state === "taken"`. */
  price?: ReactNode;
}

export type SlotButtonProps = SlotGridProps | SlotRowProps;

const stateClasses: Record<SlotState, string> = {
  free: "border-border-strong bg-surface text-ink hover:border-ink",
  // Borda de 2px via ring interno, sem deslocar o layout.
  selected: "border-action bg-action-soft text-action-ink ring-1 ring-inset ring-action",
  taken: "border-dashed border-border-strong bg-disabled-bg text-muted cursor-not-allowed",
};

/**
 * Estados: livre (branco) · selecionado (laranja suave, borda 2px) ·
 * ocupado (cinza, borda tracejada, `disabled`). Livre/selecionado expõem
 * aria-pressed; ocupado é anunciado como indisponível.
 */
export function SlotButton(props: SlotButtonProps) {
  const { state, className, type = "button", layout, ...rest } = props;
  const taken = state === "taken";

  const base = cn(
    "rounded-control border font-semibold tabular transition-colors",
    stateClasses[state],
    className,
  );

  if (layout === "row") {
    const { time, price, ...buttonProps } = rest as Omit<SlotRowProps, "state" | "layout">;
    return (
      <button
        type={type}
        disabled={taken}
        aria-pressed={taken ? undefined : state === "selected"}
        className={cn(base, "flex min-h-14 w-full items-center justify-between px-5 text-body-lg")}
        {...buttonProps}
      >
        <span>{time}</span>
        {taken ? (
          <span className="text-body font-medium">Reservado</span>
        ) : (
          <span className="text-body">{price}</span>
        )}
      </button>
    );
  }

  const { time, ...buttonProps } = rest as Omit<SlotGridProps, "state" | "layout">;
  return (
    <button
      type={type}
      disabled={taken}
      aria-pressed={taken ? undefined : state === "selected"}
      aria-label={taken ? `${time}, indisponível` : undefined}
      className={cn(base, "min-h-12 w-full px-2 text-body-lg")}
      {...buttonProps}
    >
      <span className={cn(taken && "line-through")}>{time}</span>
    </button>
  );
}
