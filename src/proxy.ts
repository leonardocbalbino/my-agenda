import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { adminPath, classifyHost, isInternalPath, tenantPath } from "@/modules/tenancy/hosts";
import {
  resolveTenantByHost,
  resolveTenantBySlug,
  type ResolvedTenant,
} from "@/modules/tenancy/resolve";

/**
 * Roteia pelo Host: raiz, admin.{raiz}, {slug}.{raiz} ou domínio customizado.
 * Só ROTEIA. Autenticação e autorização acontecem nos guards (src/modules/identity/guards).
 */

const TRUSTED_HEADERS = ["x-marcai-url", "x-marcai-tenant-id", "x-marcai-tenant-slug"];

/** Caminhos que existem em qualquer host, sem rewrite. */
const SHARED_PATHS = ["/sem-acesso"];

function notFound(request: NextRequest) {
  // Rota inexistente: renderiza o not-found global com status 404.
  return NextResponse.rewrite(new URL("/__nao-encontrado", request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host");
  const target = classifyHost(host, process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "");

  // Nunca confie em cabeçalhos internos vindos de fora.
  const forwarded = new Headers(request.headers);
  for (const h of TRUSTED_HEADERS) forwarded.delete(h);
  forwarded.set("x-marcai-url", `${request.nextUrl.protocol}//${host}${pathname}${search}`);

  // /t/... e /admin/... só existem via rewrite.
  if (isInternalPath(pathname)) return notFound(request);

  if (target.kind === "invalid") return notFound(request);

  if (target.kind === "root" || SHARED_PATHS.includes(pathname)) {
    return NextResponse.next({ request: { headers: forwarded } });
  }

  // Login e API de auth só na raiz.
  if (pathname.startsWith("/api/auth") || pathname === "/entrar") return notFound(request);

  if (target.kind === "admin") {
    const url = new URL(adminPath(pathname) + search, request.url);
    return NextResponse.rewrite(url, { request: { headers: forwarded } });
  }

  const db = getDb();
  let tenant: ResolvedTenant | null;
  try {
    tenant =
      target.kind === "subdomain"
        ? await resolveTenantBySlug(db, target.slug)
        : await resolveTenantByHost(db, target.host);
  } catch (err) {
    console.error("[proxy] falha ao resolver tenant", err);
    return new NextResponse("Serviço indisponível", { status: 503 });
  }
  if (!tenant) return notFound(request);

  forwarded.set("x-marcai-tenant-id", tenant.tenantId);
  forwarded.set("x-marcai-tenant-slug", tenant.slug);
  const url = new URL(tenantPath(tenant.slug, pathname) + search, request.url);
  return NextResponse.rewrite(url, { request: { headers: forwarded } });
}

export const config = {
  // Tudo, exceto assets do Next e arquivos com extensão (imagens, fontes, favicon).
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
