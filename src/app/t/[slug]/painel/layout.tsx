import type { CSSProperties } from "react";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PanelNav, type NavItem } from "@/components/panel/nav";
import { brandStyle, brandTokens } from "@/lib/brand";
import { requireTenantAccess } from "@/modules/identity/guards";
import { ROLE_LABEL, can, type Permission } from "@/modules/identity/permissions";

const NAV: (NavItem & { permission: Permission })[] = [
  { href: "/painel", label: "Agenda", icon: "agenda", permission: "agenda:view_own" },
  { href: "/painel/clientes", label: "Clientes", icon: "clientes", permission: "customers:view" },
  { href: "/painel/servicos", label: "Serviços", icon: "servicos", permission: "catalog:manage" },
  { href: "/painel/equipe", label: "Equipe", icon: "equipe", permission: "team:manage" },
  {
    href: "/painel/financeiro",
    label: "Financeiro",
    icon: "financeiro",
    permission: "reports:view",
  },
  {
    href: "/painel/minha-pagina",
    label: "Minha página",
    icon: "pagina",
    permission: "page:manage",
  },
  {
    href: "/painel/configuracoes",
    label: "Configurações",
    icon: "config",
    permission: "settings:manage",
  },
];

/**
 * Painel do estabelecimento. Usa a cor da PLATAFORMA (petróleo), não a do
 * tenant: a marca dele aparece só no avatar.
 */
export default function PanelLayout({ children, params }: LayoutProps<"/t/[slug]/painel">) {
  return (
    <div
      style={brandStyle(null) as CSSProperties}
      className="flex min-h-full flex-1 flex-col lg:flex-row"
    >
      <Suspense fallback={<aside className="bg-ink lg:min-h-screen lg:w-64" />}>
        <Sidebar params={params} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

async function Sidebar({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tenant, user, membership } = await requireTenantAccess(slug);
  const items = NAV.filter((i) => can(membership.role, i.permission));
  const tile = brandTokens(tenant.brandColor);
  return (
    <aside className="flex flex-col gap-5 bg-ink p-4 text-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:gap-8">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          style={{ backgroundColor: tile.brand, color: tile.onBrand }}
          className="flex size-10 shrink-0 items-center justify-center rounded-control font-display text-body-lg font-bold"
        >
          {tenant.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold">{tenant.name}</p>
          <p className="text-caption text-white/80">
            {user.name.split(" ")[0]} · <span>{ROLE_LABEL[membership.role]}</span>
          </p>
        </div>
        <div className="lg:hidden">
          <SignOutButton />
        </div>
      </div>
      <PanelNav items={items.map(({ href, label, icon }) => ({ href, label, icon }))} />
      <div className="hidden lg:mt-auto lg:block">
        <SignOutButton />
      </div>
    </aside>
  );
}
