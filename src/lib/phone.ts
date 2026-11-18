/**
 * Telefones em E.164 só com dígitos ("5511999990000"), o formato que a API do
 * WhatsApp usa no campo `to` e devolve em `from`.
 */

/** "(11) 99999-0000", "+55 11 99999-0000", "011999990000" -> "5511999990000". */
export function normalizeBRPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2); // discagem internacional
  if (d.startsWith("0")) d = d.slice(1); // 0 + DDD
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55[1-9]\d(9\d{8}|[2-8]\d{7})$/.test(d)) return null;
  return d;
}

/**
 * Formas equivalentes de um celular brasileiro: o WhatsApp às vezes identifica
 * números antigos SEM o 9º dígito ("551199990000" para "5511999990000").
 */
export function phoneVariants(e164: string): string[] {
  const d = e164.replace(/\D/g, "");
  const out = new Set([d]);
  const with9 = /^(55\d{2})9(\d{8})$/.exec(d);
  if (with9) out.add(`${with9[1]}${with9[2]}`);
  const without9 = /^(55\d{2})([6-9]\d{7})$/.exec(d);
  if (without9) out.add(`${without9[1]}9${without9[2]}`);
  return [...out];
}

/** "+55 11 99999-0000" para exibir. */
export function formatPhone(e164: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${e164}`;
}

/** Para logs: "(11) 9****-0000". */
export function maskPhone(e164: string): string {
  const m = /^55(\d{2})(\d)\d*(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}****-${m[3]}` : "***";
}
