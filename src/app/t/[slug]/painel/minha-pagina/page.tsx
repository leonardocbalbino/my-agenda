import type { Metadata } from "next";
import { Suspense } from "react";
import { ComingSoon } from "@/components/panel/coming-soon";
import { requireTenantAccess } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Minha página", robots: { index: false } };

export default function Page({ params }: PageProps<"/t/[slug]/painel/minha-pagina">) {
  return (
    <Suspense fallback={null}>
      <Guarded params={params} />
    </Suspense>
  );
}

async function Guarded({ params }: { params: Promise<{ slug: string }> }) {
  await requireTenantAccess((await params).slug, "page:manage");
  return (
    <ComingSoon title="Minha página">
      Foto, descrição, endereço, cor da marca e domínio próprio da sua página de agendamento.
    </ComingSoon>
  );
}
