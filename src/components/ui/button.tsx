import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Variantes:
 * - action: laranja. SÓ para o CTA principal (Agendar / Confirmar / Pagar).
 * - brand: cor da marca (no tenant, a cor dele). Ações secundárias positivas ("Salvar").
 * - outline: ações neutras ("Cancelar").
 * - dark: ação de navegação forte ("Entrar").
 * - ghost: ações discretas, ícones.
 *
 * Exportado como `buttonVariants` para aplicar o mesmo visual em <Link>/<a>.
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control font-semibold transition-[background-color,filter,border-color]",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-5 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        action: "bg-action text-on-action hover:bg-action-ink",
        brand: "bg-brand text-on-brand hover:brightness-90",
        outline: "border border-border-strong bg-surface text-ink hover:bg-paper",
        dark: "bg-ink text-white hover:bg-ink/85",
        ghost: "text-ink hover:bg-disabled-bg",
      },
      size: {
        // Todos com alvo de toque ≥ 44px.
        md: "h-11 px-5 text-body",
        lg: "h-14 px-6 text-body-lg",
        icon: "size-11",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

type BaseProps = Omit<ComponentProps<"button">, "aria-label"> &
  Omit<VariantProps<typeof buttonVariants>, "size">;

/** Botão só com ícone exige `aria-label` (verificado em tempo de compilação). */
export type ButtonProps = BaseProps &
  ({ size?: "md" | "lg"; "aria-label"?: string } | { size: "icon"; "aria-label": string });

export function Button({
  className,
  variant,
  size,
  block,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}
