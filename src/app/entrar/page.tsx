import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default function SignInPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
      <Link href="/" aria-label="Marcaí, página inicial" className="self-start">
        <Logo />
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-title font-bold">Entrar</h1>
        <p className="text-body-lg text-muted">
          Uma conta só para agendar em qualquer lugar e gerenciar o seu negócio.
        </p>
      </div>
      <Suspense>
        <SignInForm googleEnabled={googleEnabled} />
      </Suspense>
    </main>
  );
}
