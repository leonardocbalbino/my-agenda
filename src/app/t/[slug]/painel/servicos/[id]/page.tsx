import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OfferingForm, type OfferingFormValues } from "@/components/panel/offering-form";
import { getDb } from "@/db/client";
import { centsToInput } from "@/lib/money";
import { listOfferingsAdmin, listResourcesAdmin } from "@/modules/catalog/admin";
import { requireTenantAccess } from "@/modules/identity/guards";
import { saveOfferingAction } from "../../actions";

export const metadata: Metadata = { title: "Serviço", robots: { index: false } };

/** /painel/servicos/novo cria; /painel/servicos/{id} edita. */
export default function OfferingPage({ params }: PageProps<"/t/[slug]/painel/servicos/[id]">) {
  return (
    <main className="flex flex-col gap-6 px-4 py-6 lg:px-8">
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <Editor params={params} />
      </Suspense>
    </main>
  );
}

async function Editor({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { tenant } = await requireTenantAccess(slug, "catalog:manage");
  const db = getDb();
  const resources = await listResourcesAdmin(db, tenant.tenantId);
  let values: OfferingFormValues;
  if (id === "novo") {
    const rental = resources.length > 0 && resources.every((r) => r.kind === "SPACE");
    values = {
      name: "",
      mode: rental ? "RENTAL" : "SERVICE",
      durationMinutes: 30,
      slotMinutes: 60,
      price: "",
      paymentPolicy: rental ? "DEPOSIT" : "ON_SITE",
      depositPercent: 50,
      allowRecurring: rental,
      active: true,
      resourceIds: resources.filter((r) => r.active).map((r) => r.id),
    };
  } else {
    const o = (await listOfferingsAdmin(db, tenant.tenantId)).find((x) => x.id === id);
    if (!o) notFound();
    values = {
      id: o.id,
      name: o.name,
      mode: o.mode,
      durationMinutes: o.durationMinutes,
      slotMinutes: o.slotMinutes,
      price: centsToInput(o.basePriceCents),
      paymentPolicy: o.paymentPolicy,
      depositPercent: Math.round(o.depositBps / 100),
      allowRecurring: o.allowRecurring,
      active: o.active,
      resourceIds: o.resourceIds,
    };
  }
  return (
    <>
      <h1 className="font-display text-title font-bold">
        {values.id ? values.name : "Novo serviço"}
      </h1>
      <OfferingForm
        values={values}
        resources={resources.map((r) => ({ id: r.id, name: r.name, active: r.active }))}
        action={saveOfferingAction}
      />
    </>
  );
}
