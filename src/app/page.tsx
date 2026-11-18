import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui";

// Placeholder: a landing page de verdade entra na Etapa 10.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <Logo />
      <h1 className="font-display text-title font-bold sm:text-display">
        Corte, quadra, unha. Ache o horário livre e marque agora.
      </h1>
      <p className="text-body-lg text-muted">Em construção.</p>
      {process.env.NODE_ENV !== "production" && (
        <Link
          href="/design"
          className={buttonVariants({ variant: "dark", className: "self-start" })}
        >
          Ver design system
        </Link>
      )}
    </main>
  );
}
