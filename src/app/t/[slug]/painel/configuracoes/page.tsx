import type { Metadata } from "next";
import { Suspense } from "react";
import { ComingSoon } from "@/components/panel/coming-soon";
import { requireTenantAccess } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Configurações", robots: { index: false } };

export default function Page({ params }: PageProps<"/t/[slug]/painel/configuracoes">) {
  return (
    <Suspense fallback={null}>
      <Guarded params={params} />
    </Suspense>
  );
}

async function Guarded({ params }: { params: Promise<{ slug: string }> }) {
  await requireTenantAccess((await params).slug, "settings:manage");
  return (
    <ComingSoon title="Configurações">
      Política de cancelamento, antecedência mínima, lembretes por WhatsApp e dados do negócio.
    </ComingSoon>
  );
}
