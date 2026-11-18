import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { SubmitButton } from "@/components/booking/submit-button";
import { StatusBadge, buttonVariants } from "@/components/ui";
import { getDb } from "@/db/client";
import { clock, longPeriod } from "@/lib/format";
import { cents, formatBRL } from "@/lib/money";
import { rootUrl } from "@/lib/urls";
import { FREE_CANCEL_HOURS, getCustomerBooking } from "@/modules/booking";
import { getTenant, requireUser } from "@/modules/identity/guards";
import { cancelBooking } from "../../actions";
import { ErrorBanner, param } from "../../_components/booking-flow";

export const metadata: Metadata = { title: "Seu agendamento", robots: { index: false } };

const TITLE = {
  CONFIRMED: "Agendamento confirmado",
  PENDING_PAYMENT: "Falta o pagamento",
  COMPLETED: "Atendimento concluído",
  CANCELLED: "Agendamento cancelado",
  NO_SHOW: "Você não compareceu",
} as const;

const brl = (v: number) => formatBRL(cents(v));

export default async function BookingPage({
  params,
  searchParams,
}: PageProps<"/t/[slug]/agendamento/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const tenant = await getTenant(slug);
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await getCustomerBooking(getDb(), tenant.tenantId, user.id, id);
  if (!b) notFound();

  const canCancel = b.canCancel;
  const remaining = b.priceCents - b.prepaidCents;
  const rows: [string, string][] = [
    ["Serviço", b.recurring ? `${b.offeringName} (mensalista)` : b.offeringName],
    ["Com", b.resourceName],
    ["Quando", longPeriod(b.start, b.end, b.timezone)],
    ["Valor", brl(b.priceCents)],
  ];
  if (b.prepaidCents > 0 && remaining > 0) {
    rows.push(["Online / no local", `${brl(b.prepaidCents)} / ${brl(remaining)}`]);
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <ErrorBanner code={param(sp, "erro")} />
      <div className="flex flex-col items-start gap-3">
        <StatusBadge status={b.status} />
        <h1 className="font-display text-title font-bold">{TITLE[b.status]}</h1>
        <p className="text-body-lg text-muted">{tenant.name}</p>
      </div>

      {b.status === "PENDING_PAYMENT" && b.expiresAt && (
        <div className="flex gap-3 rounded-card bg-action-soft p-4 text-action-ink">
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
          <p className="text-body">
            Pague <strong className="tabular">{brl(b.prepaidCents)}</strong> no Pix até{" "}
            <strong className="tabular">{clock(b.expiresAt, b.timezone)}</strong> para garantir o
            horário. Depois disso ele é liberado para outras pessoas. O pagamento por Pix ainda não
            está disponível nesta versão.
          </p>
        </div>
      )}

      <dl className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-5 py-3">
            <dt className="text-body text-muted">{k}</dt>
            <dd className="text-right text-body font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>

      {canCancel && (
        <form action={cancelBooking} className="flex flex-col gap-2">
          <input type="hidden" name="agendamento" value={b.id} />
          <SubmitButton variant="outline" pendingText="Cancelando…">
            {b.status === "PENDING_PAYMENT" ? "Desistir deste horário" : "Cancelar agendamento"}
          </SubmitButton>
          {b.status === "CONFIRMED" && (
            <p className="text-caption text-muted">
              Cancelamento grátis até {FREE_CANCEL_HOURS}h antes do horário.
            </p>
          )}
        </form>
      )}

      <div className="flex flex-wrap gap-3">
        <a href={rootUrl("/meus-agendamentos")} className={buttonVariants({ variant: "dark" })}>
          Meus agendamentos
        </a>
        <Link href="/" className={buttonVariants({ variant: "ghost" })}>
          Agendar outro horário
        </Link>
      </div>
    </main>
  );
}
