import { describe, expect, it } from "vitest";
import { zonedTime, type LocalDate } from "@/lib/time";
import {
  computeSlots,
  mergeIntervals,
  subtractIntervals,
  type EngineInput,
  type EngineResource,
  type OfferingInput,
} from "./engine";

const SP = "America/Sao_Paulo";
const FRI: LocalDate = { year: 2026, month: 11, day: 6 }; // sexta (5)
const SAT: LocalDate = { year: 2026, month: 11, day: 7 };
const SUN: LocalDate = { year: 2026, month: 11, day: 8 };
const LONG_AGO = new Date("2020-01-01T00:00:00Z");

const CORTE: OfferingInput = {
  mode: "SERVICE",
  durationMinutes: 30,
  slotMinutes: null,
  basePriceCents: 4500,
};
const CORTE_BARBA: OfferingInput = { ...CORTE, durationMinutes: 50, basePriceCents: 7500 };
const SOCIETY: OfferingInput = {
  mode: "RENTAL",
  durationMinutes: null,
  slotMinutes: 60,
  basePriceCents: 16000,
};

const at = (d: LocalDate, hhmm: string, tz = SP) => zonedTime(d, hhmm, tz);

function pro(
  id: string,
  rules: EngineResource["rules"],
  extra: Partial<EngineResource> = {},
): EngineResource {
  return { id, name: id, sortOrder: 0, timezone: SP, rules, ...extra };
}

const weekdays = (ranges: [string, string][], days = [1, 2, 3, 4, 5, 6]) =>
  days.flatMap((weekday) => ranges.map(([start, end]) => ({ weekday, start, end })));

const RAFA = pro(
  "rafa",
  weekdays([
    ["09:00", "12:00"],
    ["13:00", "21:00"],
  ]),
  { sortOrder: 0 },
);
const DIEGO = pro(
  "diego",
  weekdays([
    ["09:00", "13:00"],
    ["14:00", "21:00"],
  ]),
  { sortOrder: 1 },
);

function run(partial: Partial<EngineInput> & Pick<EngineInput, "resources">) {
  return computeSlots({ date: FRI, offering: CORTE, now: LONG_AGO, ...partial });
}
const times = (slots: ReturnType<typeof run>, onlyAvailable = true) =>
  slots.filter((s) => !onlyAvailable || s.available).map((s) => s.localTime);

describe("intervalos", () => {
  it("une sobrepostos e encostados", () => {
    expect(
      mergeIntervals([
        [5, 10],
        [0, 5],
        [12, 15],
        [9, 11],
      ]),
    ).toEqual([
      [0, 11],
      [12, 15],
    ]);
  });
  it("subtrai cortes", () => {
    expect(
      subtractIntervals(
        [[0, 100]],
        [
          [10, 20],
          [50, 60],
        ],
      ),
    ).toEqual([
      [0, 10],
      [20, 50],
      [60, 100],
    ]);
    expect(subtractIntervals([[0, 10]], [[0, 10]])).toEqual([]);
  });
});

describe("serviço com profissional", () => {
  it("gera a grade de 30 min dentro da jornada, respeitando o almoço", () => {
    const t = times(run({ resources: [RAFA] }));
    expect(t[0]).toBe("09:00");
    expect(t).toContain("11:30");
    expect(t).not.toContain("12:00");
    expect(t).not.toContain("12:30");
    expect(t).toContain("13:00");
    expect(t.at(-1)).toBe("20:30");
    expect(t).toHaveLength(6 + 16);
  });

  it("a duração precisa caber: 50 min não começa 11:30 (bateria no almoço) nem 20:30", () => {
    const t = times(run({ resources: [RAFA], offering: CORTE_BARBA }));
    expect(t).toContain("11:00");
    expect(t).not.toContain("11:30");
    expect(t).toContain("20:00");
    expect(t).not.toContain("20:30");
  });

  it("instantes em UTC: 18:30 em São Paulo é 21:30Z", () => {
    const slot = run({ resources: [RAFA] }).find((s) => s.localTime === "18:30")!;
    expect(slot.start.toISOString()).toBe("2026-11-06T21:30:00.000Z");
    expect(slot.end.toISOString()).toBe("2026-11-06T22:00:00.000Z");
  });

  it("reserva existente ocupa os horários que se sobrepõem a ela, inclusive os que começam antes", () => {
    const busy = [{ resourceId: "rafa", start: at(FRI, "10:00"), end: at(FRI, "10:30") }];
    const slots = run({ resources: [RAFA], offering: CORTE_BARBA, busy });
    const by = (t: string) => slots.find((s) => s.localTime === t)!;
    expect(by("09:00").available).toBe(true); // 09:00–09:50
    expect(by("09:30").available).toBe(false); // 09:30–10:20 bate
    expect(by("10:00").available).toBe(false);
    expect(by("10:30").available).toBe(true);
    // Ocupado continua na lista (a UI mostra riscado), só não está disponível.
    expect(by("10:00").workingResourceIds).toEqual(["rafa"]);
    expect(by("10:00").freeResourceIds).toEqual([]);
  });

  it("dia sem regra (domingo) não tem horários", () => {
    expect(run({ resources: [RAFA], date: SUN })).toEqual([]);
  });

  it("validade da regra (valid_from / valid_until) é respeitada", () => {
    const r = pro("temp", [{ weekday: 5, start: "09:00", end: "10:00", validFrom: "2026-11-07" }]);
    expect(run({ resources: [r] })).toEqual([]);
    const r2 = pro("temp", [
      { weekday: 5, start: "09:00", end: "10:00", validUntil: "2026-11-06" },
    ]);
    expect(times(run({ resources: [r2] }))).toEqual(["09:00", "09:30"]);
  });

  it("horários passados e dentro da antecedência mínima não ficam disponíveis", () => {
    const slots = run({ resources: [RAFA], now: at(FRI, "14:10"), leadMinutes: 60 });
    const by = (t: string) => slots.find((s) => s.localTime === t)!;
    expect(by("15:00").past).toBe(true);
    expect(by("15:00").available).toBe(false);
    expect(by("15:30").available).toBe(true);
  });
});

describe("Qualquer profissional", () => {
  it("o horário está livre se ALGUM profissional estiver livre", () => {
    const busy = [{ resourceId: "rafa", start: at(FRI, "10:00"), end: at(FRI, "10:30") }];
    const slot = run({ resources: [RAFA, DIEGO], busy }).find((s) => s.localTime === "10:00")!;
    expect(slot.available).toBe(true);
    expect(slot.freeResourceIds).toEqual(["diego"]);
    expect(slot.resourceId).toBe("diego");
  });

  it("une as jornadas: 12:00 existe porque Diego almoça mais tarde, 13:00 porque Rafa já voltou", () => {
    const slots = run({ resources: [RAFA, DIEGO] });
    expect(slots.find((s) => s.localTime === "12:00")!.freeResourceIds).toEqual(["diego"]);
    expect(slots.find((s) => s.localTime === "13:00")!.freeResourceIds).toEqual(["rafa"]);
  });

  it("indisponível só quando todos estão ocupados", () => {
    const busy = ["rafa", "diego"].map((resourceId) => ({
      resourceId,
      start: at(FRI, "10:00"),
      end: at(FRI, "10:30"),
    }));
    const slot = run({ resources: [RAFA, DIEGO], busy }).find((s) => s.localTime === "10:00")!;
    expect(slot.available).toBe(false);
    expect(slot.resourceId).toBeNull();
  });

  it("sugere o profissional com menos reservas no dia (distribui a agenda)", () => {
    const busy = [
      { resourceId: "rafa", start: at(FRI, "15:00"), end: at(FRI, "15:30") },
      { resourceId: "rafa", start: at(FRI, "16:00"), end: at(FRI, "16:30") },
    ];
    const slot = run({ resources: [RAFA, DIEGO], busy }).find((s) => s.localTime === "10:00")!;
    expect(slot.freeResourceIds).toEqual(["diego", "rafa"]);
    expect(slot.resourceId).toBe("diego");
  });

  it("empate vai pela ordem de exibição", () => {
    const slot = run({ resources: [DIEGO, RAFA] }).find((s) => s.localTime === "10:00")!;
    expect(slot.resourceId).toBe("rafa"); // sortOrder 0
  });
});

describe("exceções", () => {
  it("feriado da Location (CLOSED sem recurso) fecha todo mundo", () => {
    const exceptions = [
      { resourceId: null, kind: "CLOSED" as const, start: at(FRI, "00:00"), end: at(FRI, "24:00") },
    ];
    expect(run({ resources: [RAFA, DIEGO], exceptions })).toEqual([]);
  });

  it("folga de um profissional só afeta ele", () => {
    const exceptions = [
      {
        resourceId: "rafa",
        kind: "CLOSED" as const,
        start: at(FRI, "00:00"),
        end: at(FRI, "24:00"),
      },
    ];
    const slots = run({ resources: [RAFA, DIEGO], exceptions });
    expect(slots.every((s) => s.workingResourceIds.join() === "diego")).toBe(true);
  });

  it("bloqueio parcial (consulta médica 15h–17h)", () => {
    const exceptions = [
      {
        resourceId: "rafa",
        kind: "CLOSED" as const,
        start: at(FRI, "15:00"),
        end: at(FRI, "17:00"),
      },
    ];
    const t = times(run({ resources: [RAFA], exceptions }));
    expect(t).toContain("14:30");
    expect(t).not.toContain("15:00");
    expect(t).not.toContain("16:30");
    expect(t).toContain("17:00");
  });

  it("abertura extra (OPEN) num domingo", () => {
    const exceptions = [
      { resourceId: null, kind: "OPEN" as const, start: at(SUN, "10:00"), end: at(SUN, "12:00") },
    ];
    expect(times(run({ resources: [RAFA], date: SUN, exceptions }))).toEqual([
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
  });
});

describe("virada de dia", () => {
  const ARENA = pro("society1", weekdays([["08:00", "24:00"]], [0, 1, 2, 3, 4, 5, 6]));

  it("slot 23:00–00:00 da arena termina no dia seguinte", () => {
    const slots = run({ resources: [ARENA], offering: SOCIETY });
    const last = slots.at(-1)!;
    expect(last.localTime).toBe("23:00");
    expect(last.end.toISOString()).toBe("2026-11-07T03:00:00.000Z"); // 00:00 de sábado em SP
    expect(slots).toHaveLength(16); // 08:00 ... 23:00
  });

  it("atendimento que atravessa a meia-noite cabe quando há expediente dos dois lados", () => {
    const late = pro("noturno", [
      { weekday: 5, start: "22:00", end: "24:00" },
      { weekday: 6, start: "00:00", end: "02:00" },
    ]);
    const t = times(run({ resources: [late], offering: { ...CORTE, durationMinutes: 60 } }));
    expect(t).toEqual(["22:00", "22:30", "23:00", "23:30"]);
  });

  it("...e não cabe se o dia seguinte não tem expediente", () => {
    const late = pro("noturno", [{ weekday: 5, start: "22:00", end: "24:00" }]);
    const t = times(run({ resources: [late], offering: { ...CORTE, durationMinutes: 60 } }));
    expect(t).toEqual(["22:00", "22:30", "23:00"]);
  });

  it("slots da madrugada pertencem ao dia em que começam", () => {
    const late = pro("noturno", [
      { weekday: 5, start: "22:00", end: "24:00" },
      { weekday: 6, start: "00:00", end: "02:00" },
    ]);
    const fri = times(run({ resources: [late] }));
    const sat = times(run({ resources: [late], date: SAT }));
    expect(fri.every((t) => t >= "22:00")).toBe(true);
    expect(sat).toEqual(["00:00", "00:30", "01:00", "01:30"]);
  });

  it("reserva de sexta 23:30–00:30 bloqueia o sábado 00:00", () => {
    const late = pro("noturno", [
      { weekday: 5, start: "22:00", end: "24:00" },
      { weekday: 6, start: "00:00", end: "02:00" },
    ]);
    const busy = [{ resourceId: "noturno", start: at(FRI, "23:30"), end: at(SAT, "00:30") }];
    expect(times(run({ resources: [late], date: SAT, busy }))).toEqual(["00:30", "01:00", "01:30"]);
  });
});

describe("fusos e horário de verão", () => {
  it("o mesmo 09:00 local vira instantes UTC diferentes em fusos diferentes", () => {
    const manaus = pro("manaus", weekdays([["09:00", "10:00"]]), { timezone: "America/Manaus" });
    const sp = pro("sp", weekdays([["09:00", "10:00"]]));
    const [m] = run({ resources: [manaus] });
    const [s] = run({ resources: [sp] });
    expect(m.start.toISOString()).toBe("2026-11-06T13:00:00.000Z"); // UTC-4
    expect(s.start.toISOString()).toBe("2026-11-06T12:00:00.000Z"); // UTC-3
  });

  it("início do horário de verão (Nova York, 08/03/2026): 02:xx não existe e a madrugada tem 1h a menos", () => {
    const NY = "America/New_York";
    const day: LocalDate = { year: 2026, month: 3, day: 8 }; // domingo
    const r = pro("ny", [{ weekday: 0, start: "01:00", end: "05:00" }], { timezone: NY });
    const slots = run({ resources: [r], date: day, offering: { ...CORTE, durationMinutes: 60 } });
    // 02:00 e 02:30 não existem nesse dia. 01:30 + 1h real termina às 03:30 locais.
    expect(slots.map((s) => s.localTime)).toEqual(["01:00", "01:30", "03:00", "03:30", "04:00"]);
    expect(slots[1].end.toISOString()).toBe(zonedTime(day, "03:30", NY).toISOString());
    // A janela 01:00–05:00 local tem só 3h reais.
    expect(slots.every((s) => s.end.getTime() - s.start.getTime() === 60 * 60_000)).toBe(true);
  });

  it("fim do horário de verão (Nova York, 01/11/2026): nenhum slot duplicado", () => {
    const NY = "America/New_York";
    const day: LocalDate = { year: 2026, month: 11, day: 1 };
    const r = pro("ny", [{ weekday: 0, start: "00:00", end: "03:00" }], { timezone: NY });
    const slots = run({ resources: [r], date: day, offering: { ...CORTE, durationMinutes: 60 } });
    const starts = slots.map((s) => s.start.getTime());
    expect(new Set(starts).size).toBe(starts.length);
    expect(slots.every((s) => s.end.getTime() - s.start.getTime() === 60 * 60_000)).toBe(true);
  });
});

describe("locação com preço por faixa", () => {
  const ARENA = pro("society1", weekdays([["16:00", "24:00"]], [0, 1, 2, 3, 4, 5, 6]));
  const NOBRE = {
    resourceId: null,
    weekdays: null,
    start: "18:00",
    end: "24:00",
    holidaysOnly: false,
    priceCents: 22000,
    priority: 1,
  };
  const FERIADO = { ...NOBRE, start: "08:00", holidaysOnly: true, priceCents: 25000, priority: 10 };

  it("horário nobre a partir das 18h", () => {
    const slots = run({ resources: [ARENA], offering: SOCIETY, pricingRules: [NOBRE] });
    const price = (t: string) => slots.find((s) => s.localTime === t)!.priceCents;
    expect(price("16:00")).toBe(16000);
    expect(price("17:00")).toBe(16000);
    expect(price("18:00")).toBe(22000);
    expect(price("23:00")).toBe(22000);
  });

  it("regra de feriado tem prioridade, e só vale em feriado", () => {
    const slots = run({
      resources: [ARENA],
      offering: SOCIETY,
      pricingRules: [NOBRE, FERIADO],
      holidays: ["2026-11-06"],
    });
    expect(slots.find((s) => s.localTime === "16:00")!.priceCents).toBe(25000);
    expect(slots.find((s) => s.localTime === "20:00")!.priceCents).toBe(25000);
    const normal = run({
      resources: [ARENA],
      offering: SOCIETY,
      pricingRules: [NOBRE, FERIADO],
      holidays: [],
    });
    expect(normal.find((s) => s.localTime === "16:00")!.priceCents).toBe(16000);
  });

  it("regra por dia da semana", () => {
    const fimDeSemana = {
      ...NOBRE,
      weekdays: [0, 6],
      start: "16:00",
      priceCents: 30000,
      priority: 5,
    };
    const fri = run({ resources: [ARENA], offering: SOCIETY, pricingRules: [fimDeSemana] });
    const sat = run({
      resources: [ARENA],
      offering: SOCIETY,
      pricingRules: [fimDeSemana],
      date: SAT,
    });
    expect(fri[0].priceCents).toBe(16000);
    expect(sat[0].priceCents).toBe(30000);
  });

  it("reserva ocupa o slot da quadra", () => {
    const busy = [{ resourceId: "society1", start: at(FRI, "19:00"), end: at(FRI, "20:00") }];
    const slots = run({ resources: [ARENA], offering: SOCIETY, busy });
    expect(slots.find((s) => s.localTime === "19:00")!.available).toBe(false);
    expect(slots.find((s) => s.localTime === "20:00")!.available).toBe(true);
  });
});
