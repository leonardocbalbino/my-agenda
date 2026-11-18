import type { CSSProperties, ReactNode } from "react";
import { Suspense } from "react";
import { brandStyle } from "@/lib/brand";
import { getTenant } from "@/modules/identity/guards";

/**
 * Raiz de todas as páginas de um tenant (alcançada só via rewrite do proxy).
 * Aplica a cor da marca: --brand e derivados. --action e status não mudam.
 */
export default function TenantLayout({ children, params }: LayoutProps<"/t/[slug]">) {
  return (
    <Suspense fallback={null}>
      <TenantFrame params={params}>{children}</TenantFrame>
    </Suspense>
  );
}

async function TenantFrame({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  const { slug } = await params;
  const tenant = await getTenant(slug);
  return (
    <div
      data-tenant={tenant.slug}
      style={brandStyle(tenant.brandColor) as CSSProperties}
      className="flex min-h-full flex-1 flex-col"
    >
      {tenant.status === "SUSPENDED" && (
        <p
          role="status"
          className="bg-status-pending px-4 py-2 text-center text-body text-status-pending-fg"
        >
          Este estabelecimento está com a conta suspensa e não aceita novos agendamentos.
        </p>
      )}
      {children}
    </div>
  );
}
