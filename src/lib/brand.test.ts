import { describe, expect, it } from "vitest";
import { brandStyle, brandTokens, contrast, parseHex, toHex } from "./brand";

const WHITE = "#FFFFFF";
const PAPER = "#FAFAF7";

describe("contrast", () => {
  it("bate com valores de referência WCAG", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // Laranja de ação com texto branco (identidade v0.1)
    expect(contrast("#C2410C", WHITE)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("parseHex / toHex", () => {
  it("normaliza #abc e caixa", () => {
    expect(toHex(parseHex("#0f766e"))).toBe("#0F766E");
    expect(toHex(parseHex("fff"))).toBe("#FFFFFF");
  });

  it("rejeita cor inválida", () => {
    expect(() => parseHex("vermelho")).toThrow(TypeError);
  });
});

describe("brandTokens", () => {
  it("usa os valores exatos da identidade para o petróleo padrão e para null", () => {
    const expected = {
      brand: "#0F766E",
      onBrand: WHITE,
      brandSoft: "#CCEDE7",
      brandInk: "#115E59",
    };
    expect(brandTokens("#0f766e")).toEqual(expected);
    expect(brandTokens(null)).toEqual(expected);
  });

  it("usa texto escuro sobre marca clara", () => {
    const t = brandTokens("#FACC15"); // amarelo
    expect(t.onBrand).toBe("#121417");
    expect(t.brand).toBe("#FACC15");
  });

  it("escurece a marca quando nem branco nem tinta passam AA", () => {
    // Faixa intermediária: ~4.3:1 contra os dois.
    const t = brandTokens("#2F86A6");
    expect(t.onBrand).toBe(WHITE);
    expect(contrast(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
  });

  const samples = [
    "#7A4E24",
    "#166534",
    "#FACC15",
    "#E11D48",
    "#2563EB",
    "#9333EA",
    "#F97316",
    "#22C55E",
    "#06B6D4",
    "#A3A3A3",
    "#000000",
    "#FFFFFF",
    "#FDE68A",
    "#2F86A6",
  ];

  it.each(samples)("%s: todas as combinações passam AA (4.5:1)", (hex) => {
    const t = brandTokens(hex);
    expect(contrast(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.brandInk, t.brandSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.brandInk, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.brandInk, PAPER)).toBeGreaterThanOrEqual(4.5);
  });

  it("brandStyle expõe só tokens de marca (nunca --action ou status)", () => {
    expect(Object.keys(brandStyle("#7A4E24")).sort()).toEqual(
      ["--brand", "--brand-ink", "--brand-soft", "--on-brand"].sort(),
    );
  });
});
