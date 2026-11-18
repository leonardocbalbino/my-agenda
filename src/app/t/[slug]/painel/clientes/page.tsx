import type { Metadata } from "next";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { getPublicCatalog } from "@/modules/catalog/public";
import { listCustomers } from "@/modules/catalog/admin";
import { requireTenantAccess } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Clientes", robots: { index: false } };

export default function CustomersPage({ params }: PageProps<"/t/[slug]/painel/clientes">) {
  return (
    <main className="flex flex-col gap-6 px-4 py-6 lg:px-8">
      <h1 className="font-display text-title font-bold">Clientes</h1>
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <Customers params={params} />
      </Suspense>
    </main>
  );
}

async function Customers({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tenant, user, membership } = await requireTenantAccess(slug, "customers:view");
  const db = getDb();
  const tz =
    (await getPublicCatalog(db, tenant.tenantId)).location?.timezone ?? "America/Sao_Paulo";
  const rows = await listCustomers(db, tenant.tenantId, { userId: user.id, membership });
  const date = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat("pt-BR", {
          timeZone: tz,
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(new Date(v))
      : "—";

  if (!rows.length) return <p className="text-body-lg text-muted">Ainda não há clientes.</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[40rem] text-left text-body">
        <caption className="sr-only">Clientes do estabelecimento</caption>
        <thead className="border-b border-border text-caption text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              Cliente
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Contato
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              Atendimentos
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              Faltas
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Última visita
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Próxima
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => (
            <tr key={c.id}>
              <th scope="row" className="px-4 py-3 font-semibold">
                {c.name}
                {!c.hasAccount && (
                  <span className="ml-2 text-caption font-normal text-muted">balcão</span>
                )}
              </th>
              <td className="px-4 py-3 text-muted">{c.phone || c.email || "—"}</td>
              <td className="px-4 py-3 text-right tabular">{c.visits}</td>
              <td
                className={`px-4 py-3 text-right tabular ${c.noShowCount > 0 ? "font-semibold text-status-cancelled-fg" : ""}`}
              >
                {c.noShowCount}
              </td>
              <td className="px-4 py-3 tabular">{date(c.lastVisit)}</td>
              <td className="px-4 py-3 tabular">{date(c.nextVisit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
