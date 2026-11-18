import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { signInUrl } from "@/lib/urls";
import { resolveTenantBySlug, type ResolvedTenant } from "@/modules/tenancy/resolve";
import { getAuth } from "./auth";
import { isPlatformAdmin, loadMembership, type Membership } from "./membership";
import { can, type Permission } from "./permissions";

/**
 * Data Access Layer de autenticação/autorização.
 * Toda página, Server Action e Route Handler protegidos chamam estes guards:
 * o proxy só roteia, não autoriza.
 */

export const REQUEST_URL_HEADER = "x-marcai-url";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Uma leitura de sessão por requisição. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
});

/** URL original que o usuário pediu (o proxy grava antes do rewrite). */
async function currentUrl(): Promise<string | undefined> {
  return (await headers()).get(REQUEST_URL_HEADER) ?? undefined;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(signInUrl(await currentUrl()));
  return user;
}

/**
 * Páginas de tenant são sempre dinâmicas (agenda em tempo real, dados do banco).
 * `connection()` declara isso antes de qualquer leitura de relógio ou banco.
 */
export const getTenant = cache(async (slug: string): Promise<ResolvedTenant> => {
  await connection();
  const tenant = await resolveTenantBySlug(getDb(), slug);
  if (!tenant) notFound();
  return tenant;
});

export interface TenantAccess {
  tenant: ResolvedTenant;
  user: SessionUser;
  membership: Membership;
}

/**
 * Exige usuário logado com membership no tenant e, opcionalmente, uma permissão.
 * Sem login -> tela de login (volta para cá). Sem acesso -> /sem-acesso.
 */
export async function requireTenantAccess(
  slug: string,
  permission?: Permission,
): Promise<TenantAccess> {
  const tenant = await getTenant(slug);
  const user = await requireUser();
  const membership = await loadMembership(getDb(), tenant.tenantId, user.id);
  if (!membership || (permission && !can(membership.role, permission))) {
    redirect("/sem-acesso");
  }
  return { tenant, user, membership };
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await isPlatformAdmin(getDb(), user.id))) redirect("/sem-acesso");
  return user;
}
