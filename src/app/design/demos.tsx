"use client";

import { useState } from "react";
import { Chip, SlotButton, type SlotState } from "@/components/ui";
import { NICHES, NICHE_LABEL, type Niche } from "@/modules/catalog/niches";
import { formatBRL, cents } from "@/lib/money";

export function ChipDemo() {
  const [selected, setSelected] = useState<Niche | "ALL">("ALL");
  return (
    <div role="group" aria-label="Filtrar por nicho" className="flex flex-wrap gap-2">
      <Chip selected={selected === "ALL"} onClick={() => setSelected("ALL")}>
        Todos
      </Chip>
      {NICHES.map((n) => (
        <Chip key={n} selected={selected === n} onClick={() => setSelected(n)}>
          {NICHE_LABEL[n].full}
        </Chip>
      ))}
    </div>
  );
}

const GRID = ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"];
const GRID_TAKEN = new Set(["17:00", "18:00", "20:00"]);

export function SlotGridDemo() {
  const [selected, setSelected] = useState("18:30");
  return (
    <div role="group" aria-label="Horários de hoje" className="grid max-w-md grid-cols-4 gap-2">
      {GRID.map((t) => {
        const state: SlotState = GRID_TAKEN.has(t) ? "taken" : t === selected ? "selected" : "free";
        return <SlotButton key={t} time={t} state={state} onClick={() => setSelected(t)} />;
      })}
    </div>
  );
}

const ROWS = [
  { time: "18:00 – 19:00", price: 16000, taken: false },
  { time: "19:00 – 20:00", price: 22000, taken: true },
  { time: "20:00 – 21:00", price: 22000, taken: false },
  { time: "21:00 – 22:00", price: 22000, taken: false },
];

export function SlotRowDemo() {
  const [selected, setSelected] = useState("20:00 – 21:00");
  return (
    <div role="group" aria-label="Horários da quadra" className="flex max-w-md flex-col gap-2">
      {ROWS.map((r) => (
        <SlotButton
          key={r.time}
          layout="row"
          time={r.time}
          price={formatBRL(cents(r.price), { hideZeroCents: true })}
          state={r.taken ? "taken" : r.time === selected ? "selected" : "free"}
          onClick={() => setSelected(r.time)}
        />
      ))}
    </div>
  );
}
