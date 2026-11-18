import { describe, expect, it } from "vitest";
import { prepaidAmount } from "./pricing";

describe("prepaidAmount", () => {
  it("pagar no local não cobra nada online", () => {
    expect(prepaidAmount(7500, "ON_SITE", 5000)).toBe(0);
  });

  it("integral cobra o preço todo", () => {
    expect(prepaidAmount(7500, "FULL", 5000)).toBe(7500);
  });

  it.each([
    [22000, 5000, 11000], // sinal de 50% da quadra: R$ 110
    [16000, 3000, 4800],
    [999, 5000, 500], // 499,5 -> 500 (meio centavo para cima)
    [997, 3333, 332], // 332,30 -> 332
    [1, 5000, 1],
    [0, 5000, 0],
  ])("sinal de %i centavos a %i bps = %i", (price, bps, expected) => {
    const v = prepaidAmount(price, "DEPOSIT", bps);
    expect(v).toBe(expected);
    expect(Number.isInteger(v)).toBe(true);
  });

  it("recusa valores inválidos", () => {
    expect(() => prepaidAmount(10.5, "DEPOSIT", 5000)).toThrow(RangeError);
    expect(() => prepaidAmount(1000, "DEPOSIT", 10001)).toThrow(RangeError);
    expect(() => prepaidAmount(-1, "FULL", 0)).toThrow(RangeError);
  });
});
