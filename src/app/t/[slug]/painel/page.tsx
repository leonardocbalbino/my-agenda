import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AgendaBoard } from "@/components/panel/agenda-board";
import { NewBookingButton } from "@/components/panel/new-booking";
import { buttonVariants } from "@/components/ui";
import { getDb } from "@/db/client";
import { cn } from "@/lib/cn";
import { cents, formatBRL } from "@/lib/money";
import { parseISODate } from "@/lib/time";
import { getPublicCatalog } from "@/modules/catalog/public";
import { requireTenantAccess } from "@/modules/identity/guards";
import { can, canAccessResource } from "@/modules/identity/permissions";
import { getDayAgenda, shiftDay, todayIso, type AgendaKpis } from "@/modules/scheduling/agenda";
import {
  blockAction,
  newBookingAction,
  removeBlockAction,
  rescheduleAction,
  statusAction,
} from "./actions";

export const metadata: Metadata = { title: "Agenda", robots: { index: false } };

const NO_RESOURCE = "00000000-0000-0000-0000-000000000000";
const brl = (v: number) => formatBRL(cents(v), { hideZeroCents: true });

/** Minutos desde a meia-noite local do dia exibido (fora do componente: lê o relógio). */
function minutesSince(dayStartMs: number) {
  return Math.floor((Date.now() - dayStartMs) / 60_000);
}

function title(dateIso: string) {
  const d = parseISODate(dateIso)!;
  const s = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)));
  return s.charAt(0).toUpperCase() + s.slice(1).replace("-feira", "");
}

const hourLabel = (m: number) =>
  `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;

export default function AgendaPage({ params, searchParams }: PageProps<"/t/[slug]/painel">) {
  return (
    <main className="flex flex-col gap-6 px-4 py-6 lg:px-8">
      <Suspense fallback={<p className="text-body text-muted">Carregando agenda…</p>}>
        <Agenda params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Agenda({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { tenant, membership } = await requireTenantAccess(slug, "agenda:view_own");
  const db = getDb();
  const catalog = await getPublicCatalog(db, tenant.tenantId);
  const tz = catalog.location?.timezone ?? "America/Sao_Paulo";
  const today = todayIso(tz);
  const requested = typeof sp.dia === "string" && parseISODate(sp.dia) ? sp.dia : today;
  const seeAll = can(membership.role, "agenda:view_all");

  const agenda = await getDayAgenda(db, tenant.tenantId, requested, {
    onlyResourceId: seeAll ? null : (membership.resourceId ?? NO_RESOURCE),
  });
  const manageable = (id: string) => canAccessResource(membership, id, "manage");
  const isToday = requested === today;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-title font-bold">{title(requested)}</h1>
          <p className="text-body text-muted">
            {seeAll ? "Agenda da equipe" : "Sua agenda"}
            {!isToday && " · "}
            {!isToday && (
              <Link href="/painel" className="font-medium text-brand-ink underline">
                voltar para hoje
              </Link>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/painel?dia=${shiftDay(requested, -1)}`}
            aria-label="Dia anterior"
            className={buttonVariants({ variant: "outline", size: "icon" })}
          >
            <ChevronLeft aria-hidden strokeWidth={2} />
          </Link>
          <Link
            href="/painel"
            className={buttonVariants({ variant: "outline" })}
            aria-current={isToday ? "date" : undefined}
          >
            Hoje
          </Link>
          <Link
            href={`/painel?dia=${shiftDay(requested, 1)}`}
            aria-label="Próximo dia"
            className={buttonVariants({ variant: "outline", size: "icon" })}
          >
            <ChevronRight aria-hidden strokeWidth={2} />
          </Link>
          <NewBookingButton
            date={requested}
            offerings={catalog.offerings.map((o) => ({
              id: o.id,
              name: o.name,
              resourceIds: o.resourceIds,
            }))}
            resources={agenda.columns
              .filter((c) => manageable(c.id))
              .map((c) => ({ id: c.id, name: c.name }))}
            createAction={newBookingAction}
            blockAction={blockAction}
          />
        </div>
      </header>

      <Kpis kpis={agenda.kpis} isToday={isToday} />

      {agenda.columns.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-8 text-center text-body text-muted">
          {seeAll
            ? "Cadastre profissionais ou espaços em Equipe para montar a agenda."
            : "Sua conta ainda não está ligada a uma agenda. Fale com o responsável."}
        </p>
      ) : (
        <AgendaBoard
          columns={agenda.columns.map((c) => ({ ...c, canManage: manageable(c.id) }))}
          bookings={agenda.bookings.map((b) => ({
            id: b.id,
            resourceId: b.resourceId,
            customerName: b.customerName,
            offeringName: b.offeringName,
            status: b.status,
            startMin: b.startMin,
            endMin: b.endMin,
            priceLabel: brl(b.priceCents),
            fromMarketplace: b.source === "MARKETPLACE",
          }))}
          blocks={agenda.blocks.map((x) => ({
            ...x,
            canRemove: x.resourceId ? manageable(x.resourceId) : membership.role !== "STAFF",
          }))}
          range={agenda.range}
          dayStartMs={agenda.dayStartMs}
          nowMin={isToday ? minutesSince(agenda.dayStartMs) : null}
          actions={{
            reschedule: rescheduleAction,
            setStatus: statusAction,
            removeBlock: removeBlockAction,
          }}
        />
      )}

      <ul aria-label="Legenda" className="flex flex-wrap gap-x-5 gap-y-2 text-caption text-muted">
        {[
          ["bg-status-confirmed", "Confirmado"],
          ["bg-status-pending", "Aguardando pagamento"],
          ["bg-status-completed", "Concluído"],
          ["bg-status-no-show", "Não compareceu"],
          ["bg-ink", "Bloqueio / pausa"],
        ].map(([cls, label]) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden className={cn("size-3 rounded-[4px]", cls)} />
            {label}
          </li>
        ))}
      </ul>
    </>
  );
}

function Kpis({ kpis, isToday }: { kpis: AgendaKpis; isToday: boolean }) {
  const cards = [
    {
      label: isToday ? "Agendamentos hoje" : "Agendamentos no dia",
      value: String(kpis.bookings),
      sub: `${kpis.fromMarketplace} ${kpis.fromMarketplace === 1 ? "veio" : "vieram"} do marketplace`,
      accent: true,
    },
    {
      label: "Faturamento previsto",
      value: brl(kpis.forecastCents),
      sub: `${brl(kpis.paidOnlineCents)} já pagos online`,
    },
    {
      label: "Ocupação",
      value: kpis.occupancy === null ? "—" : `${kpis.occupancy}%`,
      sub: kpis.longestFree
        ? `Livre: ${hourLabel(kpis.longestFree.from)}–${hourLabel(kpis.longestFree.to)}`
        : kpis.occupancy === null
          ? "Ninguém trabalha neste dia"
          : "Sem janelas livres",
    },
    {
      label: "Faltas no mês",
      value: kpis.noShowRate === null ? "—" : `${kpis.noShowRate}%`,
      sub: "Não compareceram / atendidos",
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <li
          key={c.label}
          className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4"
        >
          <span className="text-caption text-muted">{c.label}</span>
          <span className="font-display text-title font-bold tabular">{c.value}</span>
          <span className={cn("text-caption", c.accent ? "text-brand-ink" : "text-muted")}>
            {c.sub}
          </span>
        </li>
      ))}
    </ul>
  );
}
