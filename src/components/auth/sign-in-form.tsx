"use client";

import { MailCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { rootUrl } from "@/lib/urls";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const params = useSearchParams();
  const callbackURL = params.get("callbackURL") ?? rootUrl("/");
  const [state, setState] = useState<State>({ kind: "idle" });
  const emailId = useId();
  const errorId = useId();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "")
      .trim()
      .toLowerCase();
    setState({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({ email, callbackURL });
    setState(
      error
        ? {
            kind: "error",
            message: "Não foi possível enviar o link. Confira o e-mail e tente de novo.",
          }
        : { kind: "sent", email },
    );
  }

  if (state.kind === "sent") {
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6"
      >
        <MailCheck aria-hidden className="size-8 text-brand" strokeWidth={2} />
        <h2 className="text-heading font-semibold">Confira seu e-mail</h2>
        <p className="text-body text-muted">
          Enviamos um link de acesso para <strong className="text-ink">{state.email}</strong>. Ele
          vale por 10 minutos.
        </p>
        <Button variant="ghost" onClick={() => setState({ kind: "idle" })}>
          Usar outro e-mail
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate={false}>
        <label htmlFor={emailId} className="text-body font-medium">
          E-mail
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          aria-invalid={state.kind === "error"}
          aria-describedby={state.kind === "error" ? errorId : undefined}
          className="h-12 rounded-control border border-border-strong bg-surface px-4 text-body-lg"
          placeholder="voce@exemplo.com"
        />
        {state.kind === "error" && (
          <p id={errorId} role="alert" className="text-body text-status-cancelled-fg">
            {state.message}
          </p>
        )}
        <Button type="submit" variant="dark" size="lg" block disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Enviando…" : "Receber link de acesso"}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <p className="text-center text-caption text-muted">ou</p>
          <Button
            variant="outline"
            size="lg"
            block
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
          >
            Continuar com Google
          </Button>
        </>
      )}
    </div>
  );
}
