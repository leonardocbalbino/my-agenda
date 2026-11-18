import { cn } from "@/lib/cn";

/** Ícone do Marcaí: calendário com check e o ponto laranja de ação. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect x="2" y="5" width="28" height="25" rx="7" className="fill-marcai" />
      <rect x="8" y="2" width="3" height="7" rx="1.5" className="fill-marcai" />
      <rect x="21" y="2" width="3" height="7" rx="1.5" className="fill-marcai" />
      <path
        d="M9.5 17.5l4.5 4.5 8.5-9"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25" cy="25" r="3.5" fill="#C2410C" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-heading font-bold text-ink">marcaí</span>
    </span>
  );
}
