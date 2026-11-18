/**
 * Roteamento por Host (puro, sem I/O): decide qual superfície atende a requisição.
 *
 *   marcai.com.br, www.marcai.com.br   -> raiz (landing, marketplace, login)
 *   admin.marcai.com.br                -> backoffice   (/admin/...)
 *   {slug}.marcai.com.br               -> tenant       (/t/{slug}/...)
 *   qualquer outro host                -> domínio customizado (consulta a tabela domains)
 */

export type HostTarget =
  | { kind: "root" }
  | { kind: "admin" }
  | { kind: "subdomain"; slug: string }
  | { kind: "custom"; host: string }
  | { kind: "invalid" };

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function classifyHost(rawHost: string | null, rootDomain: string): HostTarget {
  if (!rawHost) return { kind: "invalid" };
  const host = rawHost.trim().toLowerCase().replace(/\.$/, "");
  const root = rootDomain.toLowerCase();

  if (host === root || host === `www.${root}`) return { kind: "root" };

  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (sub === "admin") return { kind: "admin" };
    if (!SLUG.test(sub)) return { kind: "invalid" }; // inclui sub.sub.root
    return { kind: "subdomain", slug: sub };
  }

  // Domínio customizado: sem porta em produção. Rejeita IPs e lixo.
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host)) {
    return { kind: "invalid" };
  }
  return { kind: "custom", host: host.replace(/:\d+$/, "") };
}

/** Prefixos internos: só são alcançáveis via rewrite do proxy, nunca pela URL. */
export const INTERNAL_PREFIXES = ["/t/", "/admin"] as const;

export function isInternalPath(pathname: string): boolean {
  return (
    pathname === "/t" ||
    INTERNAL_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`),
    )
  );
}

export function tenantPath(slug: string, pathname: string): string {
  return `/t/${slug}${pathname === "/" ? "" : pathname}`;
}

export function adminPath(pathname: string): string {
  return `/admin${pathname === "/" ? "" : pathname}`;
}
