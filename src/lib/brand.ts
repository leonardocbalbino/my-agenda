/**
 * Deriva os tokens de marca de um tenant a partir do `brand_color` dele,
 * garantindo contraste WCAG AA (4.5:1) em todas as combinações que a UI usa:
 *
 *   --brand     fundo do header e de botões de marca
 *   --on-brand  texto sobre --brand (branco ou tinta)
 *   --brand-soft  fundo suave (chips de horário no card, destaques)
 *   --brand-ink   texto/links na cor da marca, sobre branco, papel e --brand-soft
 *
 * --action e as cores de status NÃO passam por aqui: são fixos na plataforma.
 */

export interface BrandTokens {
  brand: string;
  onBrand: string;
  brandSoft: string;
  brandInk: string;
}

export const DEFAULT_BRAND = "#0F766E";
const WHITE = "#FFFFFF";
const INK = "#121417";
const PAPER = "#FAFAF7";
const AA = 4.5;

/** Valores da identidade v0.1 para o petróleo padrão, usados sem derivação. */
const DEFAULT_TOKENS: BrandTokens = {
  brand: "#0F766E",
  onBrand: WHITE,
  brandSoft: "#CCEDE7",
  brandInk: "#115E59",
};

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new TypeError(`Cor inválida: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura `hex` com `target` (0 = hex puro, 1 = target puro). */
function mix(hex: string, target: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount) as Rgb);
}

/** Escurece em passos de 4% até `ok(cor)` ser verdadeiro. */
function darkenUntil(hex: string, ok: (c: string) => boolean): string {
  for (let step = 0; step <= 25; step++) {
    const c = mix(hex, "#000000", step * 0.04);
    if (ok(c)) return c;
  }
  return "#000000";
}

export function brandTokens(input: string | null | undefined): BrandTokens {
  if (!input) return DEFAULT_TOKENS;
  const base = toHex(parseHex(input));
  if (base === DEFAULT_BRAND) return DEFAULT_TOKENS;

  // 1. Texto sobre a marca: branco se passar; senão tinta; senão escurece a marca.
  let brand = base;
  let onBrand: string;
  if (contrast(WHITE, brand) >= AA) {
    onBrand = WHITE;
  } else if (contrast(INK, brand) >= AA) {
    onBrand = INK;
  } else {
    // Faixa intermediária em que nem branco nem tinta chegam a 4.5:1.
    brand = darkenUntil(brand, (c) => contrast(WHITE, c) >= AA);
    onBrand = WHITE;
  }

  // 2. Fundo suave: 18% da marca sobre branco.
  const brandSoft = mix(base, WHITE, 0.82);

  // 3. Tinta da marca: legível sobre o fundo suave, branco e papel.
  const brandInk = darkenUntil(
    base,
    (c) => contrast(c, brandSoft) >= AA && contrast(c, WHITE) >= AA && contrast(c, PAPER) >= AA,
  );

  return { brand, onBrand, brandSoft, brandInk };
}

/** Pronto para `style={...}` no layout do tenant. */
export function brandStyle(input: string | null | undefined): Record<string, string> {
  const t = brandTokens(input);
  return {
    "--brand": t.brand,
    "--on-brand": t.onBrand,
    "--brand-soft": t.brandSoft,
    "--brand-ink": t.brandInk,
  };
}
