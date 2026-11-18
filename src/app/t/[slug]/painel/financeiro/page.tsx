import type { Metadata } from "next";
import { Suspense } from "react";
import { ComingSoon } from "@/components/panel/coming-soon";
import { requireTenantAccess } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Financeiro", robots: { index: false } };

export default function Page({ params }: PageProps<"/t/[slug]/painel/financeiro">) {
  return (
    <Suspense fallback={null}>
      <Guarded params={params} />
    </Suspense>
  );
}

async function Guarded({ params }: { params: Promise<{ slug: string }> }) {
  await requireTenantAccess((await params).slug, "reports:view");
  return (
    <ComingSoon title="Financeiro">
      Faturamento por período, comissões da plataforma e repasses dos pagamentos online.
    </ComingSoon>
  );
}
