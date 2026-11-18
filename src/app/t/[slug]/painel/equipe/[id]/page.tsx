import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HoursEditor, ResourceForm } from "@/components/panel/team-forms";
import { getDb } from "@/db/client";
import { longPeriod } from "@/lib/format";
import { getWeeklyRules, listResourcesAdmin, listUpcomingClosures } from "@/modules/catalog/admin";
import { getPublicCatalog } from "@/modules/catalog/public";
import { requireTenantAccess } from "@/modules/identity/guards";
import { saveHoursAction, saveResourceAction } from "../../actions";

/** Fechamento de dia(s) inteiro(s): começa e termina à meia-noite local. */
function wholeDays(start: Date, end: Date) {
  return (
    end.getTime() - start.getTime() >= 86_400_000 &&
    (end.getTime() - start.getTime()) % 3_600_000 === 0
  );
}

export const metadata: Metadata = { title: "Agenda da equipe", robots: { index: false } };

export default function ResourcePage({ params }: PageProps<"/t/[slug]/painel/equipe/[id]">) {
  return (
    <main className="flex flex-col gap-8 px-4 py-6 lg:px-8">
      <Link
        href="/painel/equipe"
        className="flex min-h-11 items-center gap-1 self-start text-body font-medium text-brand-ink"
      >
        <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
        Equipe
      </Link>
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <Resource params={params} />
      </Suspense>
    </main>
  );
}

async function Resource({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { tenant } = await requireTenantAccess(slug, "team:manage");
  const db = getDb();
  const r = (await listResourcesAdmin(db, tenant.tenantId)).find((x) => x.id === id);
  if (!r) notFound();
  const rules = await getWeeklyRules(db, tenant.tenantId, r.id);
  const closures = (await listUpcomingClosures(db, tenant.tenantId)).filter(
    (c) => c.resourceId === r.id || c.resourceId === null,
  );
  const tz =
    (await getPublicCatalog(db, tenant.tenantId)).location?.timezone ?? "America/Sao_Paulo";

  return (
    <>
      <section aria-labelledby="dados" className="flex flex-col gap-3">
        <h1 id="dados" className="font-display text-title font-bold">
          {r.name}
        </h1>
        <ResourceForm
          action={saveResourceAction}
          values={{ id: r.id, name: r.name, kind: r.kind, active: r.active }}
        />
      </section>

      <section aria-labelledby="horarios" className="flex flex-col gap-3">
        <h2 id="horarios" className="text-heading font-semibold">
          Horários de atendimento
        </h2>
        <HoursEditor initial={rules} save={saveHoursAction.bind(null, r.id)} />
      </section>

      <section aria-labelledby="bloqueios" className="flex flex-col gap-3">
        <h2 id="bloqueios" className="text-heading font-semibold">
          Próximos bloqueios e folgas
        </h2>
        {closures.length === 0 ? (
          <p className="text-body text-muted">
            Nenhum. Bloqueie horários pela agenda, em “Novo agendamento”.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {closures.map((c) => (
              <li
                key={c.id}
                className="rounded-control border border-border bg-surface px-4 py-3 text-body"
              >
                <span className="font-semibold">{c.reason || "Bloqueio"}</span>
                {c.resourceId === null && <span className="text-muted"> · unidade inteira</span>}
                <span className="block text-muted tabular">
                  {wholeDays(c.period.start, c.period.end)
                    ? `${longPeriod(c.period.start, c.period.end, tz).split(",").slice(0, 2).join(",")} (dia inteiro)`
                    : longPeriod(c.period.start, c.period.end, tz)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
