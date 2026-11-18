import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export interface ChipProps extends Omit<ComponentProps<"button">, "aria-pressed"> {
  selected?: boolean;
}

/** Chip de filtro (nicho, categoria). Toggle acessível via aria-pressed. */
export function Chip({ selected = false, className, type = "button", ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 items-center rounded-pill border px-4 text-body font-medium whitespace-nowrap transition-colors",
        selected
          ? "border-ink bg-ink text-white"
          : "border-border-strong bg-surface text-ink hover:bg-paper",
        className,
      )}
      {...props}
    />
  );
}
