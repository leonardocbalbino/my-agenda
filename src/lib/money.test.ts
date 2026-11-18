import { describe, expect, it } from "vitest";
import { cents, formatBRL } from "./money";

const NBSP = " ";

describe("cents", () => {
  it("aceita inteiros", () => {
    expect(cents(4500)).toBe(4500);
  });

  it.each([45.5, 0.1 + 0.2, Number.NaN, Infinity])("rejeita não-inteiro %s", (v) => {
    expect(() => cents(v)).toThrow(TypeError);
  });
});

describe("formatBRL", () => {
  it.each([
    [0, `R$${NBSP}0,00`],
    [5, `R$${NBSP}0,05`],
    [6000, `R$${NBSP}60,00`],
    [138550, `R$${NBSP}1.385,50`],
    [123456789, `R$${NBSP}1.234.567,89`],
    [-4500, `-R$${NBSP}45,00`],
  ])("%i centavos -> %s", (v, expected) => {
    expect(formatBRL(cents(v))).toBe(expected);
  });

  it("omite ,00 quando pedido", () => {
    expect(formatBRL(cents(4500), { hideZeroCents: true })).toBe(`R$${NBSP}45`);
    expect(formatBRL(cents(4550), { hideZeroCents: true })).toBe(`R$${NBSP}45,50`);
  });

  it("é exato no maior inteiro seguro (sem arredondamento de float)", () => {
    expect(formatBRL(cents(Number.MAX_SAFE_INTEGER))).toBe(`R$${NBSP}90.071.992.547.409,91`);
  });
});
