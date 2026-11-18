import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requirePlatformAdmin } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Backoffice", robots: { index: false } };

// Provisório: o backoffice entra na Etapa 10.
export default function AdminHome() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <Admin />
      </Suspense>
    </main>
  );
}

async function Admin() {
  const user = await requirePlatformAdmin();
  return (
    <>
      <h1 className="font-display text-title font-bold">Backoffice</h1>
      <p className="text-body-lg">Conectado como {user.email} (super admin).</p>
      <div>
        <SignOutButton />
      </div>
    </>
  );
}
