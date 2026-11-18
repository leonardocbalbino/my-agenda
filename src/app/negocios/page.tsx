import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getDb } from "@/db/client";
import { tenantUrl } from "@/lib/urls";
import { requireUser } from "@/modules/identity/guards";
import { listMyBusinesses } from "@/modules/identity/membership";

export const metadata: Metadata = { title: "Seus negócios" };

const ROLE_LABEL = { OWNER: "Dono", MANAGER: "Gerente", STAFF: "Equipe" } as const;

export default function BusinessesPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-display text-title font-bold">Seus negócios</h1>
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <BusinessList />
      </Suspense>
    </main>
  );
}

async function BusinessList() {
  const user = await requireUser();
  const businesses = await listMyBusinesses(getDb(), user.id);
  return (
    <>
      <p className="text-body text-muted">Conectado como {user.email}</p>
      {businesses.length === 0 ? (
        <p className="text-body-lg">Você ainda não faz parte da equipe de nenhum negócio.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {businesses.map((b) => (
            <li key={b.tenantId}>
              <a
                href={tenantUrl(b.slug, "/painel")}
                className="flex min-h-16 items-center justify-between rounded-card border border-border bg-surface px-5 hover:border-border-strong"
              >
                <span className="flex flex-col">
                  <span className="text-body-lg font-semibold">{b.name}</span>
                  <span className="text-caption text-muted">{ROLE_LABEL[b.role]}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 text-muted" strokeWidth={2} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <div>
        <SignOutButton />
      </div>
    </>
  );
}
