/**
 * Matriz de permissões por papel no tenant (pura, sem I/O).
 *
 * | Papel   | Pode                                                          |
 * |---------|---------------------------------------------------------------|
 * | OWNER   | tudo do tenant, incluindo cobrança e dados bancários          |
 * | MANAGER | agenda de todos, serviços, equipe, clientes, relatórios       |
 * | STAFF   | só a própria agenda: bloquear horários, concluir, marcar falta |
 *
 * SUPER_ADMIN é papel da PLATAFORMA (users.platform_role), não de tenant.
 */

export const MEMBERSHIP_ROLES = ["OWNER", "MANAGER", "STAFF"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const PERMISSIONS = [
  "agenda:view_all",
  "agenda:manage_all",
  "agenda:view_own",
  "agenda:manage_own",
  "catalog:manage",
  "team:manage",
  "customers:view",
  "reports:view",
  "page:manage",
  "settings:manage",
  "billing:manage",
  "payouts:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: Permission[] = [
  "agenda:view_all",
  "agenda:manage_all",
  "agenda:view_own",
  "agenda:manage_own",
  "catalog:manage",
  "team:manage",
  "customers:view",
  "reports:view",
];

const STAFF: Permission[] = ["agenda:view_own", "agenda:manage_own"];

export const ROLE_PERMISSIONS: Record<MembershipRole, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  MANAGER: new Set(MANAGER),
  STAFF: new Set(STAFF),
};

export function can(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export interface MembershipScope {
  role: MembershipRole;
  /** Recurso (agenda) do membro. Obrigatório para STAFF. */
  resourceId: string | null;
}

/**
 * Pode ver/alterar a agenda de um recurso específico?
 * OWNER/MANAGER: qualquer recurso. STAFF: só o próprio.
 */
export function canAccessResource(
  m: MembershipScope,
  resourceId: string,
  action: "view" | "manage",
): boolean {
  if (can(m.role, action === "view" ? "agenda:view_all" : "agenda:manage_all")) return true;
  return (
    can(m.role, action === "view" ? "agenda:view_own" : "agenda:manage_own") &&
    m.resourceId !== null &&
    m.resourceId === resourceId
  );
}
