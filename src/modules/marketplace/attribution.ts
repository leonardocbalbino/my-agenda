/**
 * Atribuição "veio do marketplace" (que define a comissão maior).
 *
 * O link do card leva `?ref=<token>`: um HMAC-SHA256 do servidor sobre
 * {tenant, validade}. Sem token válido PARA AQUELE TENANT e dentro da validade,
 * a reserva conta como da página do estabelecimento. Não dá para forjar, nem
 * reaproveitar o token de um estabelecimento em outro.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const REF_TTL_MS = 6 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.MARKETPLACE_REF_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("Defina MARKETPLACE_REF_SECRET (ou BETTER_AUTH_SECRET)");
  return s;
}

const b64 = (buf: Buffer) => buf.toString("base64url");
const mac = (payload: string, key: string) =>
  createHmac("sha256", key).update(`mref.${payload}`).digest();

export function signRef(tenantId: string, now = Date.now(), key = secret()): string {
  const payload = b64(Buffer.from(`${tenantId}.${now + REF_TTL_MS}`));
  return `${payload}.${b64(mac(payload, key))}`;
}

export function verifyRef(
  token: string | null | undefined,
  tenantId: string,
  now = Date.now(),
  key = secret(),
): boolean {
  if (!token || token.length > 300) return false;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return false;
  const expected = mac(payload, key);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const [t, exp] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  return t === tenantId && Number(exp) > now;
}
