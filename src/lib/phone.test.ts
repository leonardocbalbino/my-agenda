import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, normalizeBRPhone, phoneVariants } from "./phone";

describe("normalizeBRPhone", () => {
  it.each([
    ["(11) 99999-0000", "5511999990000"],
    ["+55 11 99999-0000", "5511999990000"],
    ["011 99999 0000", "5511999990000"],
    ["5511999990000", "5511999990000"],
    ["(21) 3333-4444", "552133334444"], // fixo
    ["0055 11 99999-0000", "5511999990000"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeBRPhone(input)).toBe(expected);
  });

  it.each([null, "", "abc", "1234", "(00) 99999-0000", "11 19999-0000", "+1 415 555 0100"])(
    "recusa %s",
    (input) => {
      expect(normalizeBRPhone(input)).toBeNull();
    },
  );
});

describe("phoneVariants", () => {
  it("celular com 9: também aceita sem o 9º dígito", () => {
    expect(phoneVariants("5511999990000").sort()).toEqual(["551199990000", "5511999990000"].sort());
  });
  it("celular sem 9 (como o WhatsApp às vezes devolve): também aceita com", () => {
    expect(phoneVariants("551199990000").sort()).toEqual(["551199990000", "5511999990000"].sort());
  });
  it("fixo não ganha variante", () => {
    expect(phoneVariants("552133334444")).toEqual(["552133334444"]);
  });
});

describe("exibição", () => {
  it("formata e mascara", () => {
    expect(formatPhone("5511999990000")).toBe("(11) 99999-0000");
    expect(maskPhone("5511999990000")).toBe("(11) 9****-0000");
  });
});
