import { buttonVariants } from "@/components/ui";
import { rootUrl } from "@/lib/urls";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <p className="text-caption font-semibold tracking-wide text-muted uppercase">Erro 404</p>
      <h1 className="font-display text-title font-bold">Página não encontrada</h1>
      <p className="text-body-lg text-muted">
        O endereço pode estar errado ou o estabelecimento não está mais no Marcaí.
      </p>
      <a
        href={rootUrl("/")}
        className={buttonVariants({ variant: "dark", className: "self-start" })}
      >
        Ir para o início
      </a>
    </main>
  );
}
