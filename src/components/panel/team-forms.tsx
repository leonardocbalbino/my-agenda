"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { SubmitButton } from "@/components/booking/submit-button";
import { Button } from "@/components/ui";
import { Checkbox, Field, FormMessage, echo, echoChecked, inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/app/t/[slug]/painel/actions";

type FormAction = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

const KINDS = [
  ["PROFESSIONAL", "Profissional"],
  ["SPACE", "Espaço (quadra, sala)"],
  ["EQUIPMENT", "Equipamento"],
] as const;

export function ResourceForm({
  action,
  values,
}: {
  action: FormAction;
  values?: { id: string; name: string; kind: string; active: boolean };
}) {
  const [state, formAction] = useActionState(action, null);
  const issues = state && !state.ok ? (state.issues ?? {}) : {};
  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end" noValidate>
      {values && <input type="hidden" name="id" value={values.id} />}
      <Field label="Nome" error={issues.name} className="flex-1">
        {(p) => (
          <input
            {...p}
            name="nome"
            defaultValue={echo(state, "nome") ?? values?.name}
            maxLength={60}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Tipo" className="sm:w-56">
        {(p) => (
          <select
            {...p}
            name="tipo"
            defaultValue={echo(state, "tipo") ?? values?.kind ?? "PROFESSIONAL"}
            className={inputClass}
          >
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
      </Field>
      {values && (
        <Checkbox
          name="ativo"
          label="Ativo"
          defaultChecked={echoChecked(state, "ativo") ?? values.active}
        />
      )}
      <SubmitButton variant="brand" pendingText="Salvando…">
        {values ? (
          "Salvar"
        ) : (
          <>
            <Plus aria-hidden strokeWidth={2} />
            Adicionar
          </>
        )}
      </SubmitButton>
      <FormMessage state={state && !state.ok ? state : null} />
    </form>
  );
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

interface Rule {
  weekday: number;
  start: string;
  end: string;
}

/** Jornada semanal: faixas por dia (ex.: 09–12 e 13–21). Salva tudo de uma vez. */
export function HoursEditor({
  initial,
  save,
}: {
  initial: Rule[];
  save: (rules: Rule[]) => Promise<ActionResult>;
}) {
  const [rules, setRules] = useState<Rule[]>(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const update = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {WEEKDAYS.map((label, weekday) => {
          const day = rules.map((r, i) => ({ ...r, i })).filter((r) => r.weekday === weekday);
          return (
            <li key={weekday} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
              <span className="w-28 pt-2.5 text-body font-semibold">{label}</span>
              <div className="flex flex-1 flex-col gap-2">
                {day.length === 0 && <span className="pt-2.5 text-body text-muted">Fechado</span>}
                {day.map((r) => (
                  <div key={r.i} className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`ini-${r.i}`}>
                      {label}: início
                    </label>
                    <input
                      id={`ini-${r.i}`}
                      type="time"
                      step={900}
                      value={r.start}
                      onChange={(e) => update(r.i, { start: e.target.value })}
                      className={cn(inputClass, "w-36 tabular")}
                    />
                    <span aria-hidden>–</span>
                    <label className="sr-only" htmlFor={`fim-${r.i}`}>
                      {label}: fim
                    </label>
                    <input
                      id={`fim-${r.i}`}
                      type="time"
                      step={900}
                      value={r.end === "24:00" ? "23:59" : r.end}
                      onChange={(e) =>
                        update(r.i, { end: e.target.value === "23:59" ? "24:00" : e.target.value })
                      }
                      className={cn(inputClass, "w-36 tabular")}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover faixa de ${label} ${r.start}–${r.end}`}
                      onClick={() => setRules((rs) => rs.filter((_, k) => k !== r.i))}
                    >
                      <Trash2 aria-hidden strokeWidth={2} />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  const last = day.at(-1);
                  setRules((rs) => [
                    ...rs,
                    last
                      ? { weekday, start: last.end, end: last.end < "20:00" ? "21:00" : "24:00" }
                      : { weekday, start: "09:00", end: "18:00" },
                  ]);
                }}
              >
                <Plus aria-hidden strokeWidth={2} />
                Faixa
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="brand"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await save(rules);
              setResult(r);
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? "Salvando…" : "Salvar horários"}
        </Button>
        <FormMessage state={result} />
      </div>
      <p className="text-caption text-muted">
        Para fechar até meia-noite, use 23:59. Folgas e feriados entram como bloqueio na agenda.
      </p>
    </div>
  );
}

export function MemberForm({
  action,
  resources,
  canAddOwner,
}: {
  action: FormAction;
  resources: { id: string; name: string }[];
  canAddOwner: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const [role, setRole] = useState("STAFF");
  const issues = state && !state.ok ? (state.issues ?? {}) : {};
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="E-mail" error={issues.email}>
        {(p) => (
          <input
            {...p}
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={echo(state, "email")}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Nome (opcional)">
        {(p) => (
          <input
            {...p}
            name="nome"
            maxLength={80}
            defaultValue={echo(state, "nome")}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Papel">
        {(p) => (
          <select
            {...p}
            name="papel"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={inputClass}
          >
            <option value="STAFF">Equipe: só a própria agenda</option>
            <option value="MANAGER">Gerente: agenda, serviços e equipe</option>
            {canAddOwner && <option value="OWNER">Dono: tudo, inclusive cobrança</option>}
          </select>
        )}
      </Field>
      <Field
        label="Agenda"
        error={issues.resourceId}
        hint={role === "STAFF" ? "Obrigatório para equipe" : "Opcional"}
      >
        {(p) => (
          <select
            {...p}
            name="agenda"
            defaultValue={echo(state, "agenda") ?? ""}
            className={inputClass}
          >
            <option value="">Nenhuma</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormMessage state={state} />
        <SubmitButton variant="brand" pendingText="Adicionando…" className="self-start">
          Adicionar à equipe
        </SubmitButton>
      </div>
    </form>
  );
}

export function RemoveMemberButton({
  label,
  remove,
}: {
  label: string;
  remove: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-caption text-status-cancelled-fg">
          {error}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remover ${label} da equipe`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await remove();
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        <Trash2 aria-hidden strokeWidth={2} />
      </Button>
    </span>
  );
}
