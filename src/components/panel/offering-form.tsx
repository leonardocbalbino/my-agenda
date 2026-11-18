"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/booking/submit-button";
import { buttonVariants } from "@/components/ui";
import {
  Checkbox,
  Field,
  FormMessage,
  echo,
  echoAll,
  echoChecked,
  inputClass,
} from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/app/t/[slug]/painel/actions";

export interface OfferingFormValues {
  id?: string;
  name: string;
  mode: "SERVICE" | "RENTAL";
  durationMinutes: number | null;
  slotMinutes: number | null;
  price: string;
  paymentPolicy: "ON_SITE" | "DEPOSIT" | "FULL";
  depositPercent: number;
  allowRecurring: boolean;
  active: boolean;
  resourceIds: string[];
}

export function OfferingForm({
  values,
  resources,
  action,
}: {
  values: OfferingFormValues;
  resources: { id: string; name: string; active: boolean }[];
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction] = useActionState(action, null);
  const [mode, setMode] = useState(values.mode);
  const [policy, setPolicy] = useState(values.paymentPolicy);
  const issues = state && !state.ok ? (state.issues ?? {}) : {};

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5" noValidate>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <Field label="Nome" error={issues.name}>
        {(p) => (
          <input
            {...p}
            name="nome"
            defaultValue={echo(state, "nome") ?? values.name}
            maxLength={80}
            className={inputClass}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-medium">Tipo</legend>
        {[
          [
            "SERVICE",
            "Serviço com duração",
            "Corte, manicure, sessão: o cliente escolhe quem atende",
          ],
          ["RENTAL", "Locação de horário", "Quadra, sala, equipamento: horários fixos do espaço"],
        ].map(([value, label, hint]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="modo"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value as "SERVICE" | "RENTAL")}
              className="mt-1 size-5 accent-brand"
            />
            <span className="flex flex-col">
              <span className="text-body">{label}</span>
              <span className="text-caption text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        {mode === "SERVICE" ? (
          <Field label="Duração (min)" error={issues.durationMinutes}>
            {(p) => (
              <input
                {...p}
                name="duracao"
                type="number"
                min={5}
                step={5}
                inputMode="numeric"
                defaultValue={echo(state, "duracao") ?? values.durationMinutes ?? 30}
                className={cn(inputClass, "tabular")}
              />
            )}
          </Field>
        ) : (
          <Field label="Tamanho do horário (min)" error={issues.slotMinutes}>
            {(p) => (
              <input
                {...p}
                name="slot"
                type="number"
                min={15}
                step={15}
                inputMode="numeric"
                defaultValue={echo(state, "slot") ?? values.slotMinutes ?? 60}
                className={cn(inputClass, "tabular")}
              />
            )}
          </Field>
        )}
        <Field label="Preço (R$)" error={issues.basePriceCents} hint="Ex.: 45,00">
          {(p) => (
            <input
              {...p}
              name="preco"
              inputMode="decimal"
              defaultValue={echo(state, "preco") ?? values.price}
              className={cn(inputClass, "tabular")}
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Pagamento">
          {(p) => (
            <select
              {...p}
              name="pagamento"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as OfferingFormValues["paymentPolicy"])}
              className={inputClass}
            >
              <option value="ON_SITE">No local</option>
              <option value="DEPOSIT">Sinal online</option>
              <option value="FULL">Valor integral online</option>
            </select>
          )}
        </Field>
        {policy === "DEPOSIT" && (
          <Field label="Sinal (%)" error={issues.depositPercent}>
            {(p) => (
              <input
                {...p}
                name="sinal"
                type="number"
                min={1}
                max={100}
                inputMode="numeric"
                defaultValue={echo(state, "sinal") ?? values.depositPercent}
                className={cn(inputClass, "tabular")}
              />
            )}
          </Field>
        )}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-body font-medium">Quem atende / onde acontece</legend>
        {resources.map((r) => (
          <Checkbox
            key={r.id}
            name="recursos"
            value={r.id}
            label={r.active ? r.name : `${r.name} (inativo)`}
            defaultChecked={(echoAll(state, "recursos") ?? values.resourceIds).includes(r.id)}
          />
        ))}
        {issues.resourceIds && (
          <p className="text-caption font-medium text-status-cancelled-fg">{issues.resourceIds}</p>
        )}
      </fieldset>

      <div className="flex flex-col">
        {mode === "RENTAL" && (
          <Checkbox
            name="mensalista"
            label="Aceita mensalista"
            hint="Mesmo horário toda semana, cobrança mensal"
            defaultChecked={echoChecked(state, "mensalista") ?? values.allowRecurring}
          />
        )}
        <Checkbox
          name="ativo"
          label="Ativo"
          hint="Desative para tirar da página sem perder o histórico"
          defaultChecked={echoChecked(state, "ativo") ?? values.active}
        />
      </div>

      <FormMessage state={state && !state.ok ? state : null} />
      <div className="flex gap-3">
        <SubmitButton variant="brand" pendingText="Salvando…">
          Salvar
        </SubmitButton>
        <Link href="/painel/servicos" className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
