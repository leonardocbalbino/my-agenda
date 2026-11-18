/**
 * URLs absolutas entre superfícies (raiz, admin, tenant).
 * NEXT_PUBLIC_ROOT_DOMAIN inclui a porta em dev: "marcai.localhost:3000".
 */
export function rootDomain(): string {
  const d = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (!d) throw new Error("NEXT_PUBLIC_ROOT_DOMAIN não definida");
  return d.toLowerCase();
}

/** Hostname sem porta, para o atributo Domain do cookie. */
export function rootHostname(): string {
  return rootDomain().split(":")[0];
}

export function protocol(): "http" | "https" {
  return process.env.NODE_ENV === "production" && !rootDomain().includes("localhost")
    ? "https"
    : "http";
}

const join = (origin: string, path: string) =>
  `${origin}${path.startsWith("/") ? path : `/${path}`}`;

export function rootUrl(path = "/"): string {
  return join(`${protocol()}://${rootDomain()}`, path);
}

export function adminUrl(path = "/"): string {
  return join(`${protocol()}://admin.${rootDomain()}`, path);
}

export function tenantUrl(slug: string, path = "/"): string {
  return join(`${protocol()}://${slug}.${rootDomain()}`, path);
}

/** Link para o login, voltando para `returnTo` (URL absoluta) depois. */
export function signInUrl(returnTo?: string): string {
  return rootUrl(returnTo ? `/entrar?callbackURL=${encodeURIComponent(returnTo)}` : "/entrar");
}
