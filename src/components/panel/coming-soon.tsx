import { Construction } from "lucide-react";

/** Seção do painel que ainda não foi construída: diz o que vai ter, sem fingir. */
export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-4 px-4 py-6 lg:px-8">
      <h1 className="font-display text-title font-bold">{title}</h1>
      <div className="flex max-w-xl gap-3 rounded-card border border-dashed border-border-strong bg-surface p-5">
        <Construction aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={2} />
        <div className="flex flex-col gap-1 text-body">
          <p className="font-semibold">Em breve</p>
          <p className="text-muted">{children}</p>
        </div>
      </div>
    </main>
  );
}
