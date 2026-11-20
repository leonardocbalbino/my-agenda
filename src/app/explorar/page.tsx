import type { Metadata } from "next";
import { X } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { LocateButton } from "@/components/marketplace/locate-button";
import { EstablishmentCard, buttonVariants } from "@/components/ui";
import { getDb } from "@/db/client";
import { cn } from "@/lib/cn";
import { cents } from "@/lib/money";
import { tenantUrl } from "@/lib/urls";
import { NICHE_LABEL } from "@/modules/catalog/niches";
import {
  NICHE_SLUGS,
  WHEN_OPTIONS,
  dayCaption,
  nextFreeSlots,
  searchListings,
  signRef,
  slotPath,
} from "@/modules/marketplace";

export const metadata: Metadata = {
  title: "Horários livres perto de você",
  description: "Corte, quadra, unha: veja os horários livres agora e marque na hora.",
};

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) =>
  typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : "";
const num = (v: string) => (v && Number.isFinite(Number(v)) ? Number(v) : null);

function hrefWith(sp: SP, changes: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const k of ["q", "onde", "lat", "lng", "nicho", "quando"])
    if (one(sp, k)) p.set(k, one(sp, k));
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return `/explorar${qs ? `?${qs}` : ""}`;
}

export default function ExplorePage({ searchParams }: PageProps<"/explorar">) {
  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/explorar" aria-label="Marcaí, horários livres">
            <Logo />
          </Link>
          <nav aria-label="Conta" className="flex items-center gap-1 sm:gap-4">
            <Link
              href="/meus-agendamentos"
              className="hidden min-h-11 items-center px-2 text-body font-medium sm:flex"
            >
              Meus agendamentos
            </Link>
            <Link
              href="/"
              className="hidden min-h-11 items-center px-2 text-body font-medium md:flex"
            >
              Tenho um negócio
            </Link>
            <Link href="/entrar" className={buttonVariants({ variant: "dark" })}>
              Entrar
            </Link>
          </nav>
        </div>
      </header>
      <Suspense fallback={<Hero sp={{}} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Hero({ sp }: { sp: SP }) {
  const near = num(one(sp, "lat")) !== null && num(one(sp, "lng")) !== null;
  const field = "flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2";
  const input =
    "h-8 w-full bg-transparent text-body-lg text-ink placeholder:text-muted focus-visible:outline-none";
  return (
    <section className="bg-brand text-on-brand">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:py-12">
        <h1 className="max-w-2xl font-display text-title font-bold sm:text-display">
          Corte, quadra, unha. Ache o horário livre e marque agora.
        </h1>
        <form
          id="busca"
          action="/explorar"
          role="search"
          className="flex max-w-4xl flex-col gap-1 rounded-card bg-surface p-2 text-ink shadow-float md:flex-row md:items-center"
        >
          {one(sp, "nicho") && <input type="hidden" name="nicho" value={one(sp, "nicho")} />}
          <input type="hidden" name="lat" defaultValue={one(sp, "lat")} />
          <input type="hidden" name="lng" defaultValue={one(sp, "lng")} />
          <label className={field}>
            <span className="text-caption font-medium text-muted">O quê</span>
            <input
              name="q"
              defaultValue={one(sp, "q")}
              placeholder="Serviço ou estabelecimento"
              className={input}
            />
          </label>
          <div className={cn(field, "border-border md:border-l")}>
            <label className="flex flex-col gap-0.5">
              <span className="text-caption font-medium text-muted">Onde</span>
              <input
                name="onde"
                defaultValue={one(sp, "onde")}
                placeholder={near ? "Perto de você" : "Bairro ou cidade"}
                className={input}
              />
            </label>
            <div className="-ml-2 flex flex-wrap items-center">
              <LocateButton formId="busca" />
            </div>
          </div>
          <label className={cn(field, "border-border md:border-l")}>
            <span className="text-caption font-medium text-muted">Quando</span>
            <select
              name="quando"
              defaultValue={one(sp, "quando") || "agora"}
              className={cn(input, "cursor-pointer")}
            >
              {WHEN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className={buttonVariants({ variant: "action", size: "lg", className: "md:h-14" })}
          >
            Buscar horários
          </button>
        </form>
      </div>
    </section>
  );
}

async function Results({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const db = getDb();
  const niche = NICHE_SLUGS[one(sp, "nicho")] ?? null;
  const when = (WHEN_OPTIONS.find((o) => o.value === one(sp, "quando")) ?? WHEN_OPTIONS[0]).when;
  const lat = num(one(sp, "lat"));
  const lng = num(one(sp, "lng"));
  const near = lat !== null && lng !== null;

  const listings = await searchListings(db, {
    niche,
    q: one(sp, "q"),
    where: one(sp, "onde"),
    lat,
    lng,
  });
  const withSlots = await Promise.all(
    listings.map(async (l) => ({ l, next: await nextFreeSlots(db, l, when) })),
  );
  // Próximo horário livre primeiro; empate (ou sem horário) pela distância.
  withSlots.sort(
    (a, b) =>
      (a.next?.slots[0]?.start.getTime() ?? Infinity) -
        (b.next?.slots[0]?.start.getTime() ?? Infinity) ||
      (a.l.distanceMeters ?? Infinity) - (b.l.distanceMeters ?? Infinity),
  );

  const chips: [string | null, string][] = [
    [null, "Todos"],
    ["barbearia", NICHE_LABEL.BARBERSHOP.short],
    ["quadras", NICHE_LABEL.SPORTS_VENUE.short],
    ["salao", NICHE_LABEL.SALON.short],
    ["estetica", NICHE_LABEL.AESTHETICS.short],
    ["pet", NICHE_LABEL.PET.short],
  ];
  const activeChip = niche ? one(sp, "nicho") : null;

  return (
    <>
      <Hero sp={sp} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <nav aria-label="Filtrar por tipo de negócio">
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {chips.map(([slug, label]) => (
              <li key={label} className="shrink-0">
                <Link
                  href={hrefWith(sp, { nicho: slug })}
                  aria-current={activeChip === slug ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-pill border px-4 text-body font-medium whitespace-nowrap",
                    activeChip === slug
                      ? "border-ink bg-ink text-white"
                      : "border-border-strong bg-surface hover:bg-paper",
                  )}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-heading font-semibold">
            {[
              when.dayOffset === 0
                ? when.fromHour === null
                  ? "Livres agora"
                  : `Livres hoje a partir das ${when.fromHour}h`
                : "Livres amanhã",
              near ? "perto de você" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </h2>
          <p className="flex items-center gap-2 text-caption text-muted">
            Ordenado por: próximo horário livre
            {near && (
              <Link
                href={hrefWith(sp, { lat: null, lng: null })}
                className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-ink"
              >
                <X aria-hidden className="size-4" strokeWidth={2} />
                Sem localização
              </Link>
            )}
          </p>
        </div>

        {withSlots.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong px-4 py-10 text-center text-body-lg text-muted">
            Nenhum lugar encontrado com esses filtros.{" "}
            <Link href="/explorar" className="font-semibold text-brand-ink underline">
              Ver todos
            </Link>
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {withSlots.map(({ l, next }) => {
              const ref = signRef(l.tenantId);
              return (
                <li key={l.tenantId}>
                  <EstablishmentCard
                    name={l.name}
                    href={tenantUrl(l.slug, `/?ref=${encodeURIComponent(ref)}`)}
                    nicheLabel={NICHE_LABEL[l.niche].short}
                    area={l.isRental ? l.offeringNames.join(" e ") : l.neighborhood}
                    distanceMeters={l.distanceMeters ?? undefined}
                    price={
                      l.startingPriceCents !== null
                        ? {
                            kind: l.isRental ? "perHour" : "from",
                            amount: cents(l.startingPriceCents),
                          }
                        : undefined
                    }
                    placeholderColor={l.brandColor}
                    slots={
                      next?.slots.map((s) => ({
                        label: s.label,
                        href: tenantUrl(l.slug, slotPath(l, next.date, s, ref)),
                      })) ?? []
                    }
                    slotsCaption={
                      next ? `próximos livres ${dayCaption(next.date, l.timezone)}` : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}

        <aside className="mt-4 flex flex-col items-start justify-between gap-4 rounded-card bg-ink p-6 text-white sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-heading font-bold">
              Tem uma barbearia, arena ou salão?
            </h2>
            <p className="max-w-xl text-body text-white/80">
              Página própria com seu endereço, agenda online, lembretes no WhatsApp e clientes novos
              vindos do marketplace.
            </p>
          </div>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Conhecer os planos
          </Link>
        </aside>
      </main>
    </>
  );
}
