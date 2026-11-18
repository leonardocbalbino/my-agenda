import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import { rootUrl } from "@/lib/urls";

export const metadata: Metadata = { title: "Sem acesso", robots: { index: false } };

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <ShieldX aria-hidden className="size-10 text-muted" strokeWidth={2} />
      <h1 className="font-display text-title font-bold">Você não tem acesso a esta área</h1>
      <p className="text-body-lg text-muted">
        Peça ao responsável pelo negócio para adicionar você à equipe, ou entre com outra conta.
      </p>
      <a
        href={rootUrl("/negocios")}
        className={buttonVariants({ variant: "dark", className: "self-start" })}
      >
        Ver meus negócios
      </a>
    </main>
  );
}
