"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { parseBRL } from "@/lib/money";
import { parseISODate, zonedTime } from "@/lib/time";
import {
  PanelError,
  blockTime,
  createPanelBooking,
  removeBlock,
  rescheduleBooking,
  setBookingStatus,
  type Actor,
} from "@/modules/booking/panel";
import type { BookingStatus } from "@/modules/booking/status";
import {
  CatalogError,
  addMember,
  removeMember,
  saveOffering,
  saveResource,
  saveWeeklyRules,
} from "@/modules/catalog/admin";
import { requireTenantAccess } from "@/modules/identity/guards";
import type { Permission } from "@/modules/identity/permissions";
import { getPublicCatalog } from "@/modules/catalog/public";

export type ActionResult =
  | { ok: true; message?: string }
  | {
      ok: false;
      error: string;
      issues?: Record<string, string>;
      /** O que foi enviado: o formulário renasce com isso em vez de ficar em branco. */
      fields?: Record<string, string | string[]>;
    };

/** Em erro, devolve os campos enviados (o React 19 limpa o formulário a cada envio). */
function keepFields(form: FormData, r: ActionResult): ActionResult {
  if (r.ok) return r;
  const fields: Record<string, string | string[]> = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$")) continue; // campos internos do React
    const all = form.getAll(key).filter((v): v is string => typeof v === "string");
    fields[key] = all.length > 1 || key === "recursos" ? all : (all[0] ?? "");
  }
  return { ...r, fields };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant pelo Host (proxy), usuário pela sessão, permissão pelo papel. */
async function panel(permission: Permission) {
  const slug = (await headers()).get("x-marcai-tenant-slug");
  if (!slug) notFound();
  const access = await requireTenantAccess(slug, permission);
  const actor: Actor = { userId: access.user.id, membership: access.membership };
  return { ...access, actor, db: getDb() };
}

function fail(e: unknown): ActionResult {
  if (e instanceof PanelError || e instanceof CatalogError) {
    return {
      ok: false,
      error: e.message,
      issues: e instanceof CatalogError ? e.issues : undefined,
    };
  }
  console.error("[painel]", e);
  return { ok: false, error: "Algo deu errado. Tente de novo." };
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

async function tz(db: ReturnType<typeof getDb>, tenantId: string) {
  return (await getPublicCatalog(db, tenantId)).location?.timezone ?? "America/Sao_Paulo";
}

function localInstant(date: string, time: string, timezone: string): Date | null {
  const d = parseISODate(date);
  if (!d || !/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(time)) return null;
  return zonedTime(d, time, timezone);
}

// --- Agenda --------------------------------------------------------------------------

export async function rescheduleAction(input: {
  bookingId: string;
  resourceId: string;
  start: string;
}): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("agenda:manage_own");
  const start = new Date(input.start);
  if (
    !UUID.test(input.bookingId) ||
    !UUID.test(input.resourceId) ||
    Number.isNaN(start.getTime())
  ) {
    return { ok: false, error: "Dados inválidos" };
  }
  try {
    await rescheduleBooking(db, tenant.tenantId, actor, { ...input, start });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel");
  return { ok: true, message: "Agendamento remarcado" };
}

export async function statusAction(input: {
  bookingId: string;
  status: BookingStatus;
}): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("agenda:manage_own");
  if (!UUID.test(input.bookingId)) return { ok: false, error: "Dados inválidos" };
  try {
    await setBookingStatus(db, tenant.tenantId, actor, input);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel");
  return { ok: true };
}

export async function newBookingAction(
  _: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  return keepFields(form, await newBookingActionImpl(form));
}

async function newBookingActionImpl(form: FormData): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("agenda:manage_own");
  const start = localInstant(str(form, "dia"), str(form, "hora"), await tz(db, tenant.tenantId));
  const offeringId = str(form, "servico");
  const resourceId = str(form, "recurso");
  const name = str(form, "nome");
  const issues: Record<string, string> = {};
  if (!name) issues.nome = "Informe o nome do cliente";
  if (!UUID.test(offeringId)) issues.servico = "Escolha o serviço";
  if (!UUID.test(resourceId)) issues.recurso = "Escolha quem atende";
  if (!start) issues.hora = "Horário inválido";
  if (Object.keys(issues).length)
    return { ok: false, error: "Confira os campos destacados", issues };
  try {
    await createPanelBooking(db, tenant.tenantId, actor, {
      offeringId,
      resourceId,
      start: start!,
      customer: { name, phone: str(form, "telefone") || null },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel");
  return { ok: true, message: "Agendamento criado" };
}

export async function blockAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return keepFields(form, await blockActionImpl(form));
}

async function blockActionImpl(form: FormData): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("agenda:manage_own");
  const timezone = await tz(db, tenant.tenantId);
  const day = str(form, "dia");
  const start = localInstant(day, str(form, "inicio"), timezone);
  const end = localInstant(day, str(form, "fim"), timezone);
  const resourceId = str(form, "recurso");
  if (!UUID.test(resourceId) || !start || !end) {
    return {
      ok: false,
      error: "Confira os campos destacados",
      issues: { inicio: "Horário inválido" },
    };
  }
  try {
    await blockTime(db, tenant.tenantId, actor, {
      resourceId,
      start,
      end,
      reason: str(form, "motivo") || null,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel");
  return { ok: true, message: "Horário bloqueado" };
}

export async function removeBlockAction(blockId: string): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("agenda:manage_own");
  if (!UUID.test(blockId)) return { ok: false, error: "Dados inválidos" };
  try {
    await removeBlock(db, tenant.tenantId, actor, blockId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel");
  return { ok: true };
}

// --- Serviços ------------------------------------------------------------------------

export async function saveOfferingAction(
  _: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  return keepFields(form, await saveOfferingActionImpl(form));
}

async function saveOfferingActionImpl(form: FormData): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("catalog:manage");
  const price = parseBRL(str(form, "preco"));
  if (price === null) {
    return {
      ok: false,
      error: "Confira os campos destacados",
      issues: { basePriceCents: "Valor inválido. Ex.: 45,00" },
    };
  }
  const num = (k: string) => (str(form, k) ? Number(str(form, k)) : null);
  const mode = str(form, "modo") === "RENTAL" ? "RENTAL" : "SERVICE";
  const policy = str(form, "pagamento");
  try {
    await saveOffering(db, tenant.tenantId, actor, {
      id: str(form, "id") || undefined,
      name: str(form, "nome"),
      mode,
      durationMinutes: mode === "SERVICE" ? num("duracao") : null,
      slotMinutes: mode === "RENTAL" ? num("slot") : null,
      basePriceCents: price,
      paymentPolicy: policy === "DEPOSIT" || policy === "FULL" ? policy : "ON_SITE",
      depositPercent: num("sinal") ?? 50,
      allowRecurring: form.get("mensalista") === "on",
      active: form.get("ativo") === "on",
      resourceIds: form.getAll("recursos").filter((v): v is string => typeof v === "string"),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel/servicos");
  redirect("/painel/servicos");
}

// --- Equipe ---------------------------------------------------------------------------

export async function saveResourceAction(
  _: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  return keepFields(form, await saveResourceActionImpl(form));
}

async function saveResourceActionImpl(form: FormData): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("team:manage");
  const kind = str(form, "tipo");
  let id: string;
  try {
    id = await saveResource(db, tenant.tenantId, actor, {
      id: str(form, "id") || undefined,
      name: str(form, "nome"),
      kind: kind === "SPACE" || kind === "EQUIPMENT" ? kind : "PROFESSIONAL",
      active: form.get("ativo") === "on" || !str(form, "id"),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel/equipe");
  redirect(`/painel/equipe/${id}`);
}

export async function saveHoursAction(
  resourceId: string,
  rules: { weekday: number; start: string; end: string }[],
): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("team:manage");
  try {
    await saveWeeklyRules(db, tenant.tenantId, actor, resourceId, rules);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/painel/equipe/${resourceId}`);
  return { ok: true, message: "Horários salvos" };
}

export async function addMemberAction(
  _: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  return keepFields(form, await addMemberActionImpl(form));
}

async function addMemberActionImpl(form: FormData): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("team:manage");
  const role = str(form, "papel");
  try {
    await addMember(db, tenant.tenantId, actor, {
      email: str(form, "email"),
      name: str(form, "nome") || undefined,
      role: role === "OWNER" || role === "MANAGER" ? role : "STAFF",
      resourceId: str(form, "agenda") || null,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel/equipe");
  return { ok: true, message: "Pessoa adicionada. Ela entra com o próprio e-mail." };
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult> {
  const { tenant, actor, db } = await panel("team:manage");
  try {
    await removeMember(db, tenant.tenantId, actor, membershipId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/painel/equipe");
  return { ok: true };
}
