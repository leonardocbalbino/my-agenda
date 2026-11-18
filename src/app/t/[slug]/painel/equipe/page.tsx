import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MemberForm, RemoveMemberButton, ResourceForm } from "@/components/panel/team-forms";
import { getDb } from "@/db/client";
import { listMembers, listResourcesAdmin } from "@/modules/catalog/admin";
import { requireTenantAccess } from "@/modules/identity/guards";
import { ROLE_LABEL } from "@/modules/identity/permissions";
import { addMemberAction, removeMemberAction, saveResourceAction } from "../actions";

export const metadata: Metadata = { title: "Equipe", robots: { index: false } };

const KIND = { PROFESSIONAL: "Profissional", SPACE: "Espaço", EQUIPMENT: "Equipamento" } as const;

export default function TeamPage({ params }: PageProps<"/t/[slug]/painel/equipe">) {
  return (
    <main className="flex flex-col gap-8 px-4 py-6 lg:px-8">
      <h1 className="font-display text-title font-bold">Equipe</h1>
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <Team params={params} />
      </Suspense>
    </main>
  );
}

async function Team({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tenant, membership, user } = await requireTenantAccess(slug, "team:manage");
  const db = getDb();
  const resources = await listResourcesAdmin(db, tenant.tenantId);
  const members = await listMembers(db, tenant.tenantId);
  const resourceName = new Map(resources.map((r) => [r.id, r.name]));

  return (
    <>
      <section aria-labelledby="agendas" className="flex flex-col gap-4">
        <div>
          <h2 id="agendas" className="text-heading font-semibold">
            Agendas
          </h2>
          <p className="text-body text-muted">
            Cada profissional ou espaço tem a própria coluna na agenda e os próprios horários.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {resources.map((r) => (
            <li key={r.id}>
              <Link
                href={`/painel/equipe/${r.id}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 hover:border-border-strong"
              >
                <span className="flex flex-col">
                  <span className="text-body-lg font-semibold">
                    {r.name}
                    {!r.active && (
                      <span className="ml-2 text-caption font-medium text-muted">(inativo)</span>
                    )}
                  </span>
                  <span className="text-caption text-muted">{KIND[r.kind]} · horários e dados</span>
                </span>
                <ChevronRight aria-hidden className="size-5 text-muted" strokeWidth={2} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="rounded-card border border-dashed border-border-strong p-4">
          <h3 className="mb-3 text-body font-semibold">Nova agenda</h3>
          <ResourceForm action={saveResourceAction} />
        </div>
      </section>

      <section aria-labelledby="pessoas" className="flex flex-col gap-4">
        <div>
          <h2 id="pessoas" className="text-heading font-semibold">
            Pessoas com acesso ao painel
          </h2>
          <p className="text-body text-muted">
            Quem você adicionar entra com o próprio e-mail, pelo link de acesso.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-semibold">
                  {m.name || m.email}
                  {m.userId === user.id && (
                    <span className="ml-2 text-caption text-muted">(você)</span>
                  )}
                </span>
                <span className="text-caption text-muted">
                  {m.email} · {ROLE_LABEL[m.role]}
                  {m.resourceId ? ` · agenda de ${resourceName.get(m.resourceId) ?? "?"}` : ""}
                </span>
              </span>
              {m.userId !== user.id && (
                <RemoveMemberButton
                  label={m.name || m.email}
                  remove={removeMemberAction.bind(null, m.id)}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="rounded-card border border-dashed border-border-strong p-4">
          <h3 className="mb-3 text-body font-semibold">Adicionar pessoa</h3>
          <MemberForm
            action={addMemberAction}
            resources={resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }))}
            canAddOwner={membership.role === "OWNER"}
          />
        </div>
      </section>
    </>
  );
}
