import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireTenantAccess } from "@/modules/identity/guards";
import { PERMISSIONS, can } from "@/modules/identity/permissions";

export const metadata: Metadata = { title: "Painel", robots: { index: false } };

const ROLE_LABEL = { OWNER: "Dono", MANAGER: "Gerente", STAFF: "Equipe" } as const;

// Provisório: a agenda do painel entra na Etapa 6.
export default function PanelPage({ params }: PageProps<"/t/[slug]/painel">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <Panel params={params} />
      </Suspense>
    </main>
  );
}

async function Panel({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tenant, user, membership } = await requireTenantAccess(slug);
  const granted = PERMISSIONS.filter((p) => can(membership.role, p));
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-body text-muted">{tenant.name}</p>
        <h1 className="font-display text-title font-bold">Olá, {user.name.split(" ")[0]}</h1>
        <p className="text-body-lg">
          Seu papel: <strong>{ROLE_LABEL[membership.role]}</strong>
        </p>
      </div>
      <section aria-labelledby="perm" className="rounded-card border border-border bg-surface p-5">
        <h2 id="perm" className="text-body-lg font-semibold">
          O que você pode fazer
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {granted.map((p) => (
            <li
              key={p}
              className="rounded-pill bg-brand-soft px-3 py-1 text-caption font-semibold text-brand-ink"
            >
              {p}
            </li>
          ))}
        </ul>
      </section>
      <div>
        <SignOutButton />
      </div>
    </>
  );
}
