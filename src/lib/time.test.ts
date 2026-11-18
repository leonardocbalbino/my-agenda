import { describe, expect, it } from "vitest";
import { addDays, todayIn, weekdayOf, zonedTime } from "./time";

describe("zonedTime", () => {
  it("São Paulo (UTC-3, sem horário de verão)", () => {
    const d = { year: 2026, month: 11, day: 6 };
    expect(zonedTime(d, "18:30", "America/Sao_Paulo").toISOString()).toBe(
      "2026-11-06T21:30:00.000Z",
    );
  });

  it("24:00 é a meia-noite do dia seguinte (slot 23:00–00:00 da arena)", () => {
    const d = { year: 2026, month: 12, day: 31 };
    expect(zonedTime(d, "24:00", "America/Sao_Paulo").toISOString()).toBe(
      "2027-01-01T03:00:00.000Z",
    );
  });

  it("respeita horário de verão onde existe (Nova York, antes e depois da troca)", () => {
    expect(
      zonedTime({ year: 2026, month: 3, day: 7 }, "10:00", "America/New_York").toISOString(),
    ).toBe("2026-03-07T15:00:00.000Z");
    expect(
      zonedTime({ year: 2026, month: 3, day: 9 }, "10:00", "America/New_York").toISOString(),
    ).toBe("2026-03-09T14:00:00.000Z");
  });

  it("rejeita hora inválida", () => {
    expect(() => zonedTime({ year: 2026, month: 1, day: 1 }, "24:30", "UTC")).toThrow(RangeError);
    expect(() => zonedTime({ year: 2026, month: 1, day: 1 }, "9:00", "UTC")).toThrow(RangeError);
  });
});

describe("datas civis", () => {
  it("todayIn usa o fuso: 01:00 UTC ainda é 'ontem' em São Paulo", () => {
    expect(todayIn("America/Sao_Paulo", new Date("2026-11-07T01:00:00Z"))).toEqual({
      year: 2026,
      month: 11,
      day: 6,
    });
  });

  it("addDays atravessa mês e ano", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(addDays({ year: 2028, month: 3, day: 1 }, -1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it("weekdayOf: 6 de novembro de 2026 é sexta (5)", () => {
    expect(weekdayOf({ year: 2026, month: 11, day: 6 })).toBe(5);
  });
});
