import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui";
import { getDb } from "@/db/client";
import { cents, formatBRL } from "@/lib/money";
import { listOfferingsAdmin, listResourcesAdmin } from "@/modules/catalog/admin";
import { requireTenantAccess } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Serviços", robots: { index: false } };

const POLICY = {
  ON_SITE: "Paga no local",
  DEPOSIT: "Sinal online",
  FULL: "Integral online",
} as const;

export default function ServicesPage({ params }: PageProps<"/t/[slug]/painel/servicos">) {
  return (
    <main className="flex flex-col gap-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-title font-bold">Serviços</h1>
        <Link href="/painel/servicos/novo" className={buttonVariants({ variant: "brand" })}>
          <Plus aria-hidden strokeWidth={2} />
          Novo serviço
        </Link>
      </div>
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <List params={params} />
      </Suspense>
    </main>
  );
}

async function List({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tenant } = await requireTenantAccess(slug, "catalog:manage");
  const db = getDb();
  const [items, res] = [
    await listOfferingsAdmin(db, tenant.tenantId),
    await listResourcesAdmin(db, tenant.tenantId),
  ];
  const names = new Map(res.map((r) => [r.id, r.name]));
  if (!items.length) {
    return <p className="text-body-lg text-muted">Nenhum serviço ainda. Crie o primeiro.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((o) => (
        <li key={o.id}>
          <Link
            href={`/painel/servicos/${o.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-4 hover:border-border-strong"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-body-lg font-semibold">
                {o.name}
                {!o.active && (
                  <span className="ml-2 text-caption font-medium text-muted">(inativo)</span>
                )}
              </span>
              <span className="text-body text-muted">
                {o.mode === "SERVICE"
                  ? `${o.durationMinutes} min`
                  : `Horários de ${o.slotMinutes} min`}{" "}
                · {POLICY[o.paymentPolicy]}
                {o.paymentPolicy === "DEPOSIT" ? ` (${o.depositBps / 100}%)` : ""}
              </span>
              <span className="text-caption text-muted">
                {o.resourceIds
                  .map((id) => names.get(id))
                  .filter(Boolean)
                  .join(", ") || "Ninguém atende ainda"}
              </span>
            </span>
            <span className="text-body-lg font-semibold tabular">
              {formatBRL(cents(o.basePriceCents), { hideZeroCents: true })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
