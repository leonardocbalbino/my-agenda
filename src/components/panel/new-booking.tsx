"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/booking/submit-button";
import { Button } from "@/components/ui";
import { Field, FormMessage, echo, inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/app/t/[slug]/painel/actions";

type FormAction = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export interface NewBookingProps {
  date: string;
  offerings: { id: string; name: string; resourceIds: string[] }[];
  /** Só as colunas que a pessoa pode gerenciar. */
  resources: { id: string; name: string }[];
  createAction: FormAction;
  blockAction: FormAction;
}

export function NewBookingButton(props: NewBookingProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"agendamento" | "bloqueio">("agendamento");
  const close = () => ref.current?.close();
  return (
    <>
      <Button
        variant="brand"
        onClick={() => ref.current?.showModal()}
        disabled={!props.resources.length}
      >
        <Plus aria-hidden strokeWidth={2} />
        Novo agendamento
      </Button>
      <dialog
        ref={ref}
        aria-labelledby="novo-titulo"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-card bg-surface p-0 text-ink shadow-float backdrop:bg-ink/40"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h2 id="novo-titulo" className="text-heading font-semibold">
              Novo na agenda
            </h2>
            <Button variant="ghost" size="icon" aria-label="Fechar" onClick={close}>
              <X aria-hidden strokeWidth={2} />
            </Button>
          </div>
          <div
            role="group"
            aria-label="Tipo"
            className="flex gap-1 rounded-control bg-disabled-bg p-1"
          >
            {(["agendamento", "bloqueio"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "min-h-11 flex-1 rounded-[10px] text-body font-semibold",
                  tab === t && "bg-surface shadow-sm",
                )}
              >
                {t === "agendamento" ? "Agendamento" : "Bloquear horário"}
              </button>
            ))}
          </div>
          {tab === "agendamento" ? (
            <BookingForm {...props} onDone={close} />
          ) : (
            <BlockForm {...props} onDone={close} />
          )}
        </div>
      </dialog>
    </>
  );
}

function useCloseOnSuccess(state: ActionResult | null, onDone: () => void) {
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
}

function BookingForm({
  date,
  offerings,
  resources,
  createAction,
  onDone,
}: NewBookingProps & { onDone: () => void }) {
  const [state, action] = useActionState(createAction, null);
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  useCloseOnSuccess(state, onDone);
  const allowed = resources.filter((r) =>
    offerings.find((o) => o.id === offeringId)?.resourceIds.includes(r.id),
  );
  const issues = state && !state.ok ? (state.issues ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="dia" value={date} />
      <Field label="Cliente" error={issues.nome}>
        {(p) => (
          <input
            {...p}
            name="nome"
            autoComplete="off"
            defaultValue={echo(state, "nome")}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Telefone (opcional)">
        {(p) => (
          <input
            {...p}
            name="telefone"
            type="tel"
            inputMode="tel"
            defaultValue={echo(state, "telefone")}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Serviço" error={issues.servico}>
        {(p) => (
          <select
            {...p}
            name="servico"
            value={offeringId}
            onChange={(e) => setOfferingId(e.target.value)}
            className={inputClass}
          >
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Com" error={issues.recurso}>
          {(p) => (
            <select
              {...p}
              name="recurso"
              defaultValue={echo(state, "recurso")}
              className={inputClass}
            >
              {allowed.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Horário" error={issues.hora}>
          {(p) => (
            <input
              {...p}
              name="hora"
              defaultValue={echo(state, "hora")}
              type="time"
              step={900}
              required
              className={cn(inputClass, "tabular")}
            />
          )}
        </Field>
      </div>
      <FormMessage state={state && !state.ok ? state : null} />
      <SubmitButton variant="brand" block pendingText="Salvando…">
        Agendar
      </SubmitButton>
    </form>
  );
}

function BlockForm({
  date,
  resources,
  blockAction,
  onDone,
}: NewBookingProps & { onDone: () => void }) {
  const [state, action] = useActionState(blockAction, null);
  useCloseOnSuccess(state, onDone);
  const issues = state && !state.ok ? (state.issues ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="dia" value={date} />
      <Field label="De quem">
        {(p) => (
          <select
            {...p}
            name="recurso"
            defaultValue={echo(state, "recurso")}
            className={inputClass}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início" error={issues.inicio}>
          {(p) => (
            <input
              {...p}
              name="inicio"
              defaultValue={echo(state, "inicio")}
              type="time"
              step={900}
              required
              className={cn(inputClass, "tabular")}
            />
          )}
        </Field>
        <Field label="Fim">
          {(p) => (
            <input
              {...p}
              name="fim"
              defaultValue={echo(state, "fim")}
              type="time"
              step={900}
              required
              className={cn(inputClass, "tabular")}
            />
          )}
        </Field>
      </div>
      <Field label="Motivo (opcional)" hint="Ex.: almoço, consulta, folga">
        {(p) => (
          <input
            {...p}
            name="motivo"
            maxLength={80}
            defaultValue={echo(state, "motivo")}
            className={inputClass}
          />
        )}
      </Field>
      <FormMessage state={state && !state.ok ? state : null} />
      <SubmitButton variant="brand" block pendingText="Salvando…">
        Bloquear
      </SubmitButton>
    </form>
  );
}
