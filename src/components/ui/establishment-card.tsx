import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDistance, formatRating } from "@/lib/format";
import { formatBRL, type Cents } from "@/lib/money";

export interface EstablishmentSlot {
  /** Horário já no fuso da Location, ex. "18:30". */
  label: string;
  /** Link direto para a confirmação, com serviço e profissional pré-selecionados. */
  href: string;
}

export type EstablishmentPrice =
  { kind: "from"; amount: Cents } | { kind: "perHour"; amount: Cents };

export interface EstablishmentCardProps {
  name: string;
  href: string;
  nicheLabel: string;
  /** Média 0–5; omitida quando ainda não há avaliações. */
  rating?: number;
  /** Bairro ou descrição curta ("Pinheiros", "Society e beach tennis"). */
  area: string;
  distanceMeters?: number;
  price?: EstablishmentPrice;
  photoUrl?: string;
  /** Cor de fundo enquanto não há foto (normalmente a brand_color do tenant). */
  placeholderColor?: string;
  /** Até 3 próximos horários livres reais. */
  slots: EstablishmentSlot[];
  slotsCaption?: string;
  headingLevel?: "h2" | "h3";
  className?: string;
}

function priceText(price: EstablishmentPrice): string {
  const v = formatBRL(price.amount, { hideZeroCents: true });
  return price.kind === "from" ? `a partir de ${v}` : `${v}/h`;
}

/**
 * Card do marketplace. O diferencial é mostrar HORÁRIOS LIVRES REAIS, não só
 * nota e distância. O nome é um link "esticado" que cobre o card inteiro; os
 * horários ficam por cima (z-10) e levam direto à confirmação.
 */
export function EstablishmentCard({
  name,
  href,
  nicheLabel,
  rating,
  area,
  distanceMeters,
  price,
  photoUrl,
  placeholderColor = "#1F2A2E",
  slots,
  slotsCaption,
  headingLevel: Heading = "h3",
  className,
}: EstablishmentCardProps) {
  const meta = [
    area,
    distanceMeters !== undefined ? formatDistance(distanceMeters) : null,
    price ? priceText(price) : null,
  ].filter(Boolean);

  return (
    <article
      className={cn(
        "relative flex flex-col overflow-hidden rounded-card border border-border bg-surface",
        "focus-within:ring-2 focus-within:ring-ink has-[a.card-link:hover]:border-border-strong",
        className,
      )}
    >
      <div className="relative aspect-[16/9] w-full" style={{ backgroundColor: placeholderColor }}>
        {photoUrl && (
          <Image
            src={photoUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        )}
        <span className="absolute bottom-2 left-2 rounded-pill bg-surface px-2.5 py-0.5 text-caption font-semibold text-ink">
          {nicheLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <Heading className="text-body-lg leading-snug font-semibold">
            <Link
              href={href}
              className="card-link outline-none after:absolute after:inset-0 after:content-['']"
            >
              {name}
            </Link>
          </Heading>
          {rating !== undefined && (
            <span className="flex shrink-0 items-center gap-1 text-body font-semibold tabular">
              <Star aria-hidden className="size-4 fill-ink" strokeWidth={2} />
              <span className="sr-only">Nota </span>
              {formatRating(rating)}
            </span>
          )}
        </div>

        <p className="text-caption text-muted tabular">{meta.join(" · ")}</p>

        {slots.length > 0 ? (
          <ul
            className="relative z-10 mt-2 flex flex-wrap gap-1.5"
            aria-label={`Próximos horários livres em ${name}`}
          >
            {slots.slice(0, 3).map((slot) => (
              <li key={slot.href}>
                <Link
                  href={slot.href}
                  aria-label={`Agendar ${slot.label} em ${name}`}
                  className="inline-flex h-11 min-w-11 items-center justify-center rounded-control bg-brand-soft px-2.5 text-body font-semibold text-brand-ink tabular transition-colors hover:bg-brand hover:text-on-brand"
                >
                  {slot.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-caption text-muted">Sem horários livres hoje</p>
        )}
        {slotsCaption && slots.length > 0 && (
          <p className="mt-1 text-caption text-muted">{slotsCaption}</p>
        )}
      </div>
    </article>
  );
}
