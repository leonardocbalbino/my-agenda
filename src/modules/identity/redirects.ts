import { classifyHost } from "@/modules/tenancy/hosts";

/** Parâmetros do Better Auth que viram redirect depois do login. */
export const REDIRECT_PARAMS = [
  "callbackURL",
  "newUserCallbackURL",
  "errorCallbackURL",
  "redirectTo",
] as const;

/**
 * Só permite voltar para a própria plataforma: caminho relativo, a raiz,
 * admin.<raiz> ou {slug}.<raiz>, no protocolo esperado.
 * Domínios customizados entram na Etapa 10 (exigem consulta à tabela domains).
 *
 * Existe porque o Better Auth 1.7 aceitou callbackURL externo no endpoint de
 * e-mail mágico (open redirect após login), apesar de trustedOrigins.
 */
export function isTrustedRedirect(
  value: string,
  rootDomain: string,
  expectedProtocol: "http" | "https",
): boolean {
  if (value.startsWith("/")) {
    // "//evil.com" e "/\evil.com" são interpretados como outro host pelo navegador.
    return !value.startsWith("//") && !value.startsWith("/\\");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== `${expectedProtocol}:` || url.username || url.password) return false;
  const kind = classifyHost(url.host, rootDomain).kind;
  return kind === "root" || kind === "admin" || kind === "subdomain";
}
