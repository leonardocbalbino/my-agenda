import { Star } from "lucide-react";
import type { ReactNode } from "react";
import { SelectButton, SlotSelect } from "@/components/booking/select";
import { SubmitButton } from "@/components/booking/submit-button";
import { cn } from "@/lib/cn";
import { dayChip, whenLabel } from "@/lib/format";
import { cents, formatBRL } from "@/lib/money";
import { toISODate, type LocalDate } from "@/lib/time";
import {
  FREE_CANCEL_HOURS,
  PENDING_HOLD_MINUTES,
  RECURRING_WEEKS,
  prepaidAmount,
} from "@/modules/booking";
import type { PublicCatalog, PublicOffering } from "@/modules/catalog/public";
import type { ResolvedTenant } from "@/modules/tenancy/resolve";
import type { Slot } from "@/modules/scheduling";
import { confirmBooking } from "../actions";

export type SearchParams = Record<string, string | string[] | undefined>;
export const param = (sp: SearchParams, k: string) =>
  typeof sp[k] === "string" ? (sp[k] as string) : null;

const brl = (v: number) => formatBRL(cents(v), { hideZeroCents: true });

const ERRORS: Record<string, string> = {
  SLOT_TAKEN: "Esse horário acabou de ser reservado por outra pessoa. Escolha outro.",
  SLOT_UNAVAILABLE: "Esse horário não está mais disponível. Escolha outro.",
  RECURRING_CONFLICT: "Algumas semanas desse horário já estão ocupadas. Tente outro horário.",
  RECURRING_NOT_ALLOWED: "Este serviço não aceita mensalista.",
  SUSPENDED: "Este estabelecimento não está aceitando agendamentos no momento.",
  PHONE: "Telefone inválido. Use o formato (11) 99999-0000.",
  CONSENT: "Para ativar os lembretes, marque a caixa de aceite.",
};

export function ErrorBanner({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <p
      role="alert"
      className="rounded-control bg-status-cancelled px-4 py-3 text-body font-medium text-status-cancelled-fg"
    >
      {ERRORS[code] ?? "Não foi possível concluir o agendamento. Tente de novo."}
    </p>
  );
}

export function StepTitle({
  n,
  children,
  aside,
}: {
  n?: number;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-sans text-caption font-semibold tracking-wider text-muted uppercase">
        {n ? `${n} · ` : ""}
        {children}
      </h2>
      {aside && <p className="text-caption text-muted">{aside}</p>}
    </div>
  );
}

export function DayStep({
  days,
  today,
  selected,
  n,
}: {
  days: LocalDate[];
  today: LocalDate;
  selected: string;
  n?: number;
}) {
  return (
    <section aria-labelledby="passo-dia" className="flex flex-col gap-3">
      <div id="passo-dia">
        <StepTitle n={n}>{n ? "Dia e horário" : "Dia"}</StepTitle>
      </div>
      <div role="group" aria-label="Dia" className="grid grid-cols-5 gap-2">
        {days.map((d) => {
          const iso = toISODate(d);
          const chip = dayChip(d, today);
          const pressed = iso === selected;
          return (
            <SelectButton
              key={iso}
              changes={{ dia: iso, hora: null }}
              pressed={pressed}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center rounded-control border tabular",
                pressed
                  ? "border-ink bg-ink text-white"
                  : "border-border-strong bg-surface text-ink",
              )}
            >
              <span className="text-caption">{chip.top}</span>
              <span className="text-heading leading-none font-semibold">{chip.bottom}</span>
              <span className="sr-only">, {chip.full}</span>
            </SelectButton>
          );
        })}
      </div>
    </section>
  );
}

/** Não mostra horários que já passaram. */
export const visible = (slots: Slot[]) => slots.filter((s) => !s.past);

export function SlotGrid({ slots, selected }: { slots: Slot[]; selected: string | null }) {
  const list = visible(slots);
  if (!list.length) return <EmptyDay />;
  return (
    <div role="group" aria-label="Horário" className="grid grid-cols-4 gap-2">
      {list.map((s) => (
        <SlotSelect
          key={s.localTime}
          time={s.localTime}
          state={!s.available ? "taken" : s.localTime === selected ? "selected" : "free"}
          changes={{ hora: s.localTime }}
        />
      ))}
    </div>
  );
}

export function SlotRows({ slots, selected }: { slots: Slot[]; selected: string | null }) {
  const list = visible(slots);
  if (!list.length) return <EmptyDay />;
  return (
    <div role="group" aria-label="Horário" className="flex flex-col gap-2">
      {list.map((s) => (
        <SlotSelect
          key={s.localTime}
          layout="row"
          time={`${s.localTime} – ${endLabel(s)}`}
          price={brl(s.priceCents)}
          state={!s.available ? "taken" : s.localTime === selected ? "selected" : "free"}
          changes={{ hora: s.localTime }}
        />
      ))}
    </div>
  );
}

function endLabel(s: Slot) {
  const mins = (s.end.getTime() - s.start.getTime()) / 60_000;
  const [h, m] = s.localTime.split(":").map(Number);
  const t = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function EmptyDay() {
  return (
    <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-body text-muted">
      Nenhum horário livre neste dia. Escolha outro dia.
    </p>
  );
}

export interface FooterProps {
  tenant: ResolvedTenant;
  catalog: PublicCatalog;
  offering: PublicOffering;
  resourceId: string | null;
  resourceLabel: string;
  day: string;
  slot: Slot | null;
  recurring: boolean;
  origin: string | null;
  /** Arena: o nome da quadra já basta ("Society 1 · Hoje 20:00"). */
  hideOfferingName?: boolean;
}

/** Rodapé fixo: resumo, total e o CTA laranja (único lugar com a cor de ação). */
export function BookingFooter(p: FooterProps) {
  const tz = p.catalog.location?.timezone ?? "America/Sao_Paulo";
  const price = p.slot?.priceCents ?? null;
  const prepaid =
    price === null ? 0 : prepaidAmount(price, p.offering.paymentPolicy, p.offering.depositBps);

  let cta = "Confirmar agendamento";
  let note = `Pague no local · cancelamento grátis até ${FREE_CANCEL_HOURS}h antes`;
  if (p.recurring && price !== null) {
    cta = `Assinar com Pix · ${brl(price * RECURRING_WEEKS)}`;
    note = `${RECURRING_WEEKS} semanas no mesmo horário · cobrança mensal`;
  } else if (prepaid > 0) {
    cta =
      p.offering.paymentPolicy === "DEPOSIT"
        ? `Pagar sinal no Pix · ${brl(prepaid)}`
        : `Pagar no Pix · ${brl(prepaid)}`;
    note = `Horário segurado por ${PENDING_HOLD_MINUTES} min até o Pix cair${
      p.offering.paymentPolicy === "DEPOSIT" ? " · resto pago no local" : ""
    }`;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface shadow-float">
      <form action={confirmBooking} className="mx-auto flex max-w-xl flex-col gap-3 px-4 pt-3 pb-4">
        <div className="flex items-baseline justify-between gap-3 text-body-lg">
          <p className="min-w-0 truncate" aria-live="polite">
            {p.slot
              ? [
                  p.hideOfferingName ? null : p.offering.name,
                  p.resourceLabel,
                  whenLabel(p.slot.start, tz),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Escolha um horário"}
          </p>
          {price !== null && <p className="font-semibold tabular">{brl(price)}</p>}
        </div>
        <input type="hidden" name="servico" value={p.offering.id} />
        {p.resourceId && <input type="hidden" name="recurso" value={p.resourceId} />}
        <input type="hidden" name="dia" value={p.day} />
        {p.slot && <input type="hidden" name="hora" value={p.slot.localTime} />}
        {p.recurring && <input type="hidden" name="mensal" value="1" />}
        {p.origin && <input type="hidden" name="origem" value={p.origin} />}
        <SubmitButton
          variant="action"
          size="lg"
          block
          disabled={!p.slot || p.tenant.status !== "ACTIVE"}
          pendingText="Reservando…"
        >
          {cta}
        </SubmitButton>
        <p className="text-center text-caption text-muted">{note}</p>
      </form>
    </div>
  );
}

export function AnyProfessionalIcon() {
  return <Star aria-hidden className="size-5" strokeWidth={2} />;
}
