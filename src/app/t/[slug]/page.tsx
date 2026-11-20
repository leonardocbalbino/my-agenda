import { getDb } from "@/db/client";
import { SelectButton } from "@/components/booking/select";
import { RecurringToggle } from "@/components/booking/select";
import { cn } from "@/lib/cn";
import { cents, formatBRL } from "@/lib/money";
import { toISODate } from "@/lib/time";
import { rootDomain } from "@/lib/urls";
import {
  getPublicCatalog,
  openDays,
  openingLabel,
  type PublicCatalog,
} from "@/modules/catalog/public";
import { getTenant } from "@/modules/identity/guards";
import { getAvailableSlots } from "@/modules/scheduling";
import type { ResolvedTenant } from "@/modules/tenancy/resolve";
import {
  AnyProfessionalIcon,
  BookingFooter,
  DayStep,
  ErrorBanner,
  SlotGrid,
  SlotRows,
  StepTitle,
  param,
  type SearchParams,
} from "./_components/booking-flow";

/** Página pública do tenant: fluxo de agendamento (barbearia/salão ou arena). */
export default async function TenantHome({ params, searchParams }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await getTenant(slug);
  const catalog = await getPublicCatalog(getDb(), tenant.tenantId);

  if (!catalog.offerings.length) {
    return (
      <>
        <ServiceHeader tenant={tenant} catalog={catalog} />
        <main className="mx-auto w-full max-w-xl px-4 py-8">
          <p className="text-body-lg text-muted">Agendamento online ainda não disponível.</p>
        </main>
      </>
    );
  }
  const rental = catalog.offerings.every((o) => o.mode === "RENTAL");
  return rental ? (
    <ArenaFlow tenant={tenant} catalog={catalog} sp={sp} />
  ) : (
    <ServiceFlow tenant={tenant} catalog={catalog} sp={sp} />
  );
}

const brl = (v: number) => formatBRL(cents(v), { hideZeroCents: true });
const initial = (name: string) => name.trim().charAt(0).toUpperCase();

function ServiceHeader({ tenant, catalog }: { tenant: ResolvedTenant; catalog: PublicCatalog }) {
  const meta = [catalog.location?.neighborhood, openingLabel(catalog)].filter(Boolean).join(" · ");
  return (
    <header className="bg-brand text-on-brand">
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-5 pb-6">
        <p className="text-caption opacity-90">
          {tenant.slug}.{rootDomain().split(":")[0]}
        </p>
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-card bg-surface font-display text-title font-bold text-brand-ink"
          >
            {initial(tenant.name)}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-heading font-bold">{tenant.name}</h1>
            <p className="text-body opacity-90">{meta}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Barbearia / salão / estética: serviço -> profissional -> dia e horário. */
async function ServiceFlow({
  tenant,
  catalog,
  sp,
}: {
  tenant: ResolvedTenant;
  catalog: PublicCatalog;
  sp: SearchParams;
}) {
  const offering =
    catalog.offerings.find((o) => o.id === param(sp, "servico")) ?? catalog.offerings[0];
  const pros = catalog.resources.filter((r) => offering.resourceIds.includes(r.id));
  const chosen = pros.find((r) => r.id === param(sp, "profissional")) ?? null;

  const { today, days } = openDays(catalog, chosen ? [chosen.id] : offering.resourceIds);
  const dayIso = days.some((d) => toISODate(d) === param(sp, "dia"))
    ? param(sp, "dia")!
    : days[0]
      ? toISODate(days[0])
      : toISODate(today);
  const { slots } = await getAvailableSlots(getDb(), tenant.tenantId, {
    offeringId: offering.id,
    resourceId: chosen?.id ?? null,
    date: dayIso,
  });
  const slot = slots.find((s) => s.available && s.localTime === param(sp, "hora")) ?? null;

  return (
    <>
      <ServiceHeader tenant={tenant} catalog={catalog} />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pt-6 pb-56">
        <ErrorBanner code={param(sp, "erro")} />

        <section aria-labelledby="passo-servico" className="flex flex-col gap-3">
          <div id="passo-servico">
            <StepTitle n={1}>Serviço</StepTitle>
          </div>
          <div role="group" aria-label="Serviço" className="flex flex-col gap-3">
            {catalog.offerings
              .filter((o) => o.mode === "SERVICE")
              .map((o) => {
                const pressed = o.id === offering.id;
                return (
                  <SelectButton
                    key={o.id}
                    changes={{ servico: o.id, profissional: null, hora: null }}
                    pressed={pressed}
                    className={cn(
                      "flex min-h-16 w-full items-center justify-between rounded-card border bg-surface px-5 py-3 text-left",
                      pressed
                        ? "border-brand ring-1 ring-brand ring-inset"
                        : "border-border-strong",
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="text-body-lg font-semibold">{o.name}</span>
                      <span className="text-body text-muted">{o.durationMinutes} min</span>
                    </span>
                    <span className="text-body-lg font-semibold tabular">
                      {brl(o.basePriceCents)}
                    </span>
                  </SelectButton>
                );
              })}
          </div>
        </section>

        <section aria-labelledby="passo-profissional" className="flex flex-col gap-3">
          <div id="passo-profissional">
            <StepTitle n={2}>Profissional</StepTitle>
          </div>
          <div role="group" aria-label="Profissional" className="grid grid-cols-4 gap-2">
            {[{ id: null, name: "Qualquer" }, ...pros].map((r) => {
              const pressed = (chosen?.id ?? null) === r.id;
              return (
                <SelectButton
                  key={r.id ?? "qualquer"}
                  changes={{ profissional: r.id, hora: null }}
                  pressed={pressed}
                  className="flex flex-col items-center gap-1.5 rounded-control py-1"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-14 items-center justify-center rounded-pill bg-disabled-bg text-body-lg font-semibold text-ink",
                      pressed && "ring-3 ring-brand",
                    )}
                  >
                    {r.id ? initial(r.name) : <AnyProfessionalIcon />}
                  </span>
                  <span className={cn("text-body", pressed && "font-semibold")}>{r.name}</span>
                </SelectButton>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <DayStep n={3} days={days} today={today} selected={dayIso} />
          <SlotGrid slots={slots} selected={slot?.localTime ?? null} />
        </section>
      </main>
      <BookingFooter
        tenant={tenant}
        catalog={catalog}
        offering={offering}
        resourceId={chosen?.id ?? null}
        resourceLabel={chosen?.name ?? "Qualquer"}
        day={dayIso}
        slot={slot}
        recurring={false}
        refToken={param(sp, "ref")}
      />
    </>
  );
}

/** Arena / quadras: quadra -> dia -> slot de 1h, com preço por faixa e mensalista. */
async function ArenaFlow({
  tenant,
  catalog,
  sp,
}: {
  tenant: ResolvedTenant;
  catalog: PublicCatalog;
  sp: SearchParams;
}) {
  const spaces = catalog.resources.filter((r) =>
    catalog.offerings.some((o) => o.resourceIds.includes(r.id)),
  );
  const space = spaces.find((r) => r.id === param(sp, "quadra")) ?? spaces[0];
  const offering = catalog.offerings.find((o) => o.resourceIds.includes(space.id))!;
  const { today, days } = openDays(catalog, [space.id]);
  const dayIso = days.some((d) => toISODate(d) === param(sp, "dia"))
    ? param(sp, "dia")!
    : days[0]
      ? toISODate(days[0])
      : toISODate(today);
  const { slots } = await getAvailableSlots(getDb(), tenant.tenantId, {
    offeringId: offering.id,
    resourceId: space.id,
    date: dayIso,
  });
  const slot = slots.find((s) => s.available && s.localTime === param(sp, "hora")) ?? null;
  const recurring = offering.allowRecurring && param(sp, "mensal") === "1";
  const subtitle = catalog.offerings.map((o) => o.name).join(" · ");

  return (
    <>
      <header className="bg-brand text-on-brand">
        <div className="mx-auto flex max-w-xl flex-col gap-1 px-4 pt-5 pb-6">
          <p className="text-caption opacity-90">
            {tenant.slug}.{rootDomain().split(":")[0]}
          </p>
          <h1 className="font-display text-title font-bold">{tenant.name}</h1>
          <p className="text-body opacity-90">{subtitle}</p>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-6 pb-56">
        <ErrorBanner code={param(sp, "erro")} />

        <div
          role="group"
          aria-label="Quadra"
          className="flex gap-1 rounded-control bg-disabled-bg p-1"
        >
          {spaces.map((r) => {
            const pressed = r.id === space.id;
            return (
              <SelectButton
                key={r.id}
                changes={{ quadra: r.id, hora: null, mensal: null }}
                pressed={pressed}
                className={cn(
                  "min-h-11 flex-1 rounded-[10px] px-2 text-body font-semibold",
                  pressed ? "bg-surface text-ink shadow-sm" : "text-ink",
                )}
              >
                {r.name}
              </SelectButton>
            );
          })}
        </div>

        <DayStep days={days} today={today} selected={dayIso} />

        <section aria-labelledby="passo-horarios" className="flex flex-col gap-3">
          <div id="passo-horarios">
            <StepTitle
              aside={
                offering.highlight
                  ? `${offering.highlight.label} a partir das ${Number(offering.highlight.from.slice(0, 2))}h`
                  : undefined
              }
            >
              Horários · {Math.round((offering.slotMinutes ?? 60) / 60)}h
            </StepTitle>
          </div>
          <SlotRows slots={slots} selected={slot?.localTime ?? null} />
        </section>

        {offering.allowRecurring && (
          <RecurringToggle
            checked={recurring}
            title="Virar mensalista"
            hint="Mesmo horário toda semana, cobrança mensal"
          />
        )}
      </main>
      <BookingFooter
        tenant={tenant}
        catalog={catalog}
        offering={offering}
        resourceId={space.id}
        resourceLabel={space.name}
        day={dayIso}
        slot={slot}
        recurring={recurring}
        hideOfferingName
        refToken={param(sp, "ref")}
      />
    </>
  );
}
