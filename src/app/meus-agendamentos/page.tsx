import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { StatusBadge } from "@/components/ui";
import { getDb } from "@/db/client";
import { longPeriod } from "@/lib/format";
import { tenantUrl } from "@/lib/urls";
import { listMyBookings, splitMyBookings, type MyBooking } from "@/modules/booking";
import { requireUser } from "@/modules/identity/guards";

export const metadata: Metadata = { title: "Meus agendamentos", robots: { index: false } };

export default function MyBookingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <Link href="/" aria-label="Marcaí, página inicial" className="self-start">
        <Logo />
      </Link>
      <h1 className="font-display text-title font-bold">Meus agendamentos</h1>
      <Suspense fallback={<p className="text-body text-muted">Carregando…</p>}>
        <List />
      </Suspense>
    </main>
  );
}

async function List() {
  const user = await requireUser();
  const all = await listMyBookings(getDb(), user.id);
  if (!all.length) {
    return <p className="text-body-lg text-muted">Você ainda não tem agendamentos.</p>;
  }
  const { upcoming, past } = splitMyBookings(all);
  return (
    <>
      <Group id="proximos" title="Próximos" items={upcoming} empty="Nenhum agendamento futuro." />
      <Group id="anteriores" title="Anteriores e cancelados" items={past} empty="Nada por aqui." />
    </>
  );
}

function Group({
  id,
  title,
  items,
  empty,
}: {
  id: string;
  title: string;
  items: MyBooking[];
  empty: string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-body-lg font-semibold">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-body text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((b) => (
            <li key={b.id}>
              <a
                href={tenantUrl(b.tenantSlug, `/agendamento/${b.id}`)}
                className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-4 hover:border-border-strong"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body-lg font-semibold">{b.tenantName}</span>
                  <span className="text-body text-muted">
                    {b.offeringName} · {b.resourceName}
                  </span>
                  <span className="text-body tabular">
                    {longPeriod(b.start, b.end, b.timezone)}
                  </span>
                  <StatusBadge status={b.status} className="self-start" />
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={2} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
