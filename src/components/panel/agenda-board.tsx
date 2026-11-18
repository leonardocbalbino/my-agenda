"use client";

import { CheckCheck, Lock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type PointerEvent } from "react";
import { Button, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  BOOKING_STATUS_LABEL,
  panelTransitions,
  type BookingStatus,
} from "@/modules/booking/status";
import type { ActionResult } from "@/app/t/[slug]/painel/actions";

/** Px por minuto: 1h = 66px, 30 min = 33px (alvo de toque confortável). */
export const PX = 1.1;
const SNAP = 15;

export interface BoardColumn {
  id: string;
  name: string;
  working: [number, number][];
  canManage: boolean;
}

export interface BoardBooking {
  id: string;
  resourceId: string;
  customerName: string;
  offeringName: string;
  status: BookingStatus;
  startMin: number;
  endMin: number;
  priceLabel: string;
  fromMarketplace: boolean;
  /** Cliente confirmou presença pelo WhatsApp. */
  customerConfirmed: boolean;
}

export interface BoardBlock {
  id: string;
  resourceId: string | null;
  reason: string | null;
  startMin: number;
  endMin: number;
  canRemove: boolean;
}

export interface BoardActions {
  reschedule: (input: {
    bookingId: string;
    resourceId: string;
    start: string;
  }) => Promise<ActionResult>;
  setStatus: (input: { bookingId: string; status: BookingStatus }) => Promise<ActionResult>;
  removeBlock: (id: string) => Promise<ActionResult>;
}

const STATUS_CLASS: Record<BookingStatus, string> = {
  CONFIRMED: "bg-status-confirmed text-status-confirmed-fg",
  PENDING_PAYMENT: "bg-status-pending text-status-pending-fg",
  COMPLETED: "bg-status-completed text-status-completed-fg",
  NO_SHOW: "bg-status-no-show text-status-no-show-fg",
  CANCELLED: "bg-status-cancelled text-status-cancelled-fg",
};

const ACTION_LABEL: Partial<Record<BookingStatus, string>> = {
  COMPLETED: "Marcar concluído",
  NO_SHOW: "Não compareceu",
  CANCELLED: "Cancelar agendamento",
  CONFIRMED: "Confirmar",
};

export const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const isMovable = (b: BoardBooking) => b.status === "CONFIRMED" || b.status === "PENDING_PAYMENT";

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  grabOffset: number;
  moved: boolean;
  target: { resourceId: string; startMin: number } | null;
}

export function AgendaBoard({
  columns,
  bookings,
  blocks,
  range,
  dayStartMs,
  nowMin,
  actions,
}: {
  columns: BoardColumn[];
  bookings: BoardBooking[];
  blocks: BoardBlock[];
  range: { from: number; to: number };
  dayStartMs: number;
  nowMin: number | null;
  actions: BoardActions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Posição otimista enquanto a remarcação é salva. */
  const [moved, setMoved] = useState<Record<string, { resourceId: string; startMin: number }>>({});
  const [selected, setSelected] = useState<BoardBooking | null>(null);
  const colRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dialogRef = useRef<HTMLDialogElement>(null);

  const height = (range.to - range.from) * PX;
  const hours: number[] = [];
  for (let m = range.from; m < range.to; m += 60) hours.push(m);
  const canManage = (resourceId: string) =>
    columns.find((c) => c.id === resourceId)?.canManage ?? false;

  // Após o refresh do servidor, a posição real substitui a otimista.
  const [seen, setSeen] = useState(bookings);
  if (seen !== bookings) {
    setSeen(bookings);
    setMoved({});
  }

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (selected && !d.open) d.showModal();
    if (!selected && d.open) d.close();
  }, [selected]);

  function run(task: () => Promise<ActionResult>, onFail?: () => void) {
    startTransition(async () => {
      const r = await task();
      if (r.ok) {
        setMessage(r.message ? { ok: true, text: r.message } : null);
        router.refresh();
      } else {
        onFail?.();
        setMessage({ ok: false, text: r.error });
      }
    });
  }

  function reschedule(b: BoardBooking, resourceId: string, startMin: number) {
    if (resourceId === b.resourceId && startMin === b.startMin) return;
    setMoved((m) => ({ ...m, [b.id]: { resourceId, startMin } }));
    run(
      () =>
        actions.reschedule({
          bookingId: b.id,
          resourceId,
          start: new Date(dayStartMs + startMin * 60_000).toISOString(),
        }),
      () => setMoved((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== b.id))),
    );
  }

  function targetAt(clientX: number, clientY: number, grabOffset: number, duration: number) {
    for (const [id, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right) continue;
      let min = range.from + (clientY - r.top - grabOffset) / PX;
      min = Math.round(min / SNAP) * SNAP;
      min = Math.max(range.from, Math.min(range.to - duration, min));
      return { resourceId: id, startMin: min };
    }
    return null;
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, b: BoardBooking) {
    if (e.button !== 0 || !isMovable(b) || !canManage(b.resourceId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      id: b.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabOffset: e.clientY - rect.top,
      moved: false,
      target: null,
    });
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>, b: BoardBooking) {
    if (!drag || drag.id !== b.id || drag.pointerId !== e.pointerId) return;
    const far = Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 5;
    if (!drag.moved && !far) return;
    const target = targetAt(e.clientX, e.clientY, drag.grabOffset, b.endMin - b.startMin);
    setDrag({
      ...drag,
      moved: true,
      target: target && canManage(target.resourceId) ? target : null,
    });
  }

  function onPointerUp(e: PointerEvent<HTMLButtonElement>, b: BoardBooking) {
    if (!drag || drag.id !== b.id) return;
    const { moved: wasDrag, target } = drag;
    setDrag(null);
    if (!wasDrag) return; // clique simples: o onClick abre os detalhes
    e.preventDefault();
    if (target) reschedule(b, target.resourceId, target.startMin);
  }

  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="text-body">
        {message && (
          <span
            className={
              message.ok ? "text-status-confirmed-fg" : "font-medium text-status-cancelled-fg"
            }
          >
            {message.text}
          </span>
        )}
      </p>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <div
          className="grid min-w-full"
          style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(10rem, 1fr))` }}
          aria-busy={pending || undefined}
        >
          {/* Cabeçalho */}
          <div className="sticky left-0 z-20 border-b border-border bg-surface" />
          {columns.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 border-b border-l border-border px-3 py-3"
            >
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-pill bg-disabled-bg text-caption font-semibold"
              >
                {c.name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-body font-semibold">{c.name}</span>
            </div>
          ))}

          {/* Horas */}
          <div className="sticky left-0 z-20 bg-surface" style={{ height }}>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute right-2 -translate-y-0 text-caption text-muted tabular"
                style={{ top: (m - range.from) * PX + 4 }}
              >
                {hhmm(m)}
              </span>
            ))}
          </div>

          {columns.map((c) => (
            <div
              key={c.id}
              ref={(el) => {
                if (el) colRefs.current.set(c.id, el);
                else colRefs.current.delete(c.id);
              }}
              className="relative border-l border-border bg-[repeating-linear-gradient(135deg,var(--disabled-bg)_0_6px,transparent_6px_12px)]"
              style={{ height }}
              aria-label={`Agenda de ${c.name}`}
              role="region"
            >
              {/* Expediente em branco sobre a faixa listrada de "fora do horário". */}
              {c.working.map(([s, e]) => (
                <div
                  key={s}
                  className="absolute inset-x-0 bg-surface"
                  style={{ top: (s - range.from) * PX, height: (e - s) * PX }}
                />
              ))}
              {/* Linhas de 30 min */}
              {hours
                .flatMap((m) => [m, m + 30])
                .map((m) => (
                  <div
                    key={m}
                    aria-hidden
                    className={cn(
                      "absolute inset-x-0 border-t",
                      m % 60 === 0 ? "border-border" : "border-border/50",
                    )}
                    style={{ top: (m - range.from) * PX }}
                  />
                ))}

              {blocks
                .filter((x) => x.resourceId === c.id || x.resourceId === null)
                .map((x) => (
                  <div
                    key={`${x.id}-${c.id}`}
                    className="absolute inset-x-1 z-10 flex items-start justify-between gap-1 overflow-hidden rounded-control bg-ink px-2 py-1.5 text-white"
                    style={{
                      top: (x.startMin - range.from) * PX + 1,
                      height: Math.max(22, (x.endMin - x.startMin) * PX - 2),
                    }}
                  >
                    <span className="min-w-0 text-caption">
                      <span className="flex items-center gap-1 font-semibold">
                        <Lock aria-hidden className="size-3.5" strokeWidth={2} />
                        {x.reason || "Bloqueio"}
                      </span>
                      <span className="tabular">
                        {hhmm(x.startMin)} – {hhmm(x.endMin)}
                      </span>
                    </span>
                    {x.canRemove && (
                      <button
                        type="button"
                        aria-label={`Remover bloqueio ${x.reason ?? ""} das ${hhmm(x.startMin)}`}
                        className="-m-1 flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-white/15"
                        onClick={() => run(() => actions.removeBlock(x.id))}
                      >
                        <X aria-hidden className="size-4" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}

              {bookings.map((b) => {
                const override = moved[b.id];
                const resourceId = override?.resourceId ?? b.resourceId;
                if (resourceId !== c.id) return null;
                const startMin = override?.startMin ?? b.startMin;
                const duration = b.endMin - b.startMin;
                const dragging = drag?.id === b.id && drag.moved;
                return (
                  <button
                    key={b.id}
                    type="button"
                    data-booking={b.id}
                    onPointerDown={(e) => onPointerDown(e, b)}
                    onPointerMove={(e) => onPointerMove(e, b)}
                    onPointerUp={(e) => onPointerUp(e, b)}
                    onPointerCancel={() => setDrag(null)}
                    onClick={(e) => {
                      if (e.defaultPrevented) return;
                      setSelected(b);
                    }}
                    aria-label={`${b.customerName}, ${b.offeringName}, ${hhmm(startMin)} às ${hhmm(startMin + duration)}, ${BOOKING_STATUS_LABEL[b.status]}${b.customerConfirmed ? ", presença confirmada" : ""}`}
                    className={cn(
                      "absolute inset-x-1 z-10 flex touch-none flex-col overflow-hidden rounded-control px-2 py-1.5 text-left select-none",
                      STATUS_CLASS[b.status],
                      isMovable(b) && canManage(b.resourceId) ? "cursor-grab" : "cursor-pointer",
                      dragging && "opacity-40",
                      override && "animate-pulse",
                    )}
                    style={{
                      top: (startMin - range.from) * PX + 1,
                      height: Math.max(22, duration * PX - 2),
                    }}
                  >
                    {b.customerConfirmed && (
                      <CheckCheck
                        aria-hidden
                        className="absolute top-1 right-1 size-3.5"
                        strokeWidth={2.5}
                      />
                    )}
                    {duration * PX < 44 ? (
                      // Bloco curto (até ~40 min): uma linha só, para não cortar o texto.
                      <span className="truncate text-caption">
                        <span className="font-semibold">{b.customerName}</span> · {b.offeringName}{" "}
                        <span className="tabular">{hhmm(startMin)}</span>
                      </span>
                    ) : (
                      <>
                        <span className="truncate text-caption font-semibold">
                          {b.customerName}
                        </span>
                        <span className="truncate text-caption">
                          {b.offeringName} · <span className="tabular">{hhmm(startMin)}</span>
                        </span>
                      </>
                    )}
                  </button>
                );
              })}

              {drag?.moved && drag.target?.resourceId === c.id && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1 z-20 rounded-control border-2 border-dashed border-ink bg-white/70 px-2 py-1 text-caption font-semibold tabular"
                  style={{
                    top: (drag.target.startMin - range.from) * PX + 1,
                    height: Math.max(
                      22,
                      (() => {
                        const b = bookings.find((x) => x.id === drag.id)!;
                        return (b.endMin - b.startMin) * PX - 2;
                      })(),
                    ),
                  }}
                >
                  {hhmm(drag.target.startMin)}
                </div>
              )}

              {nowMin !== null && nowMin >= range.from && nowMin <= range.to && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-action"
                  style={{ top: (nowMin - range.from) * PX }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        aria-labelledby="detalhe-titulo"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-card bg-surface p-0 text-ink shadow-float backdrop:bg-ink/40"
      >
        {selected && (
          <BookingDetails
            booking={selected}
            columns={columns}
            canManage={canManage(selected.resourceId)}
            busy={pending}
            onClose={() => setSelected(null)}
            onStatus={(status) => {
              const b = selected;
              setSelected(null);
              run(() => actions.setStatus({ bookingId: b.id, status }));
            }}
            onReschedule={(resourceId, startMin) => {
              const b = selected;
              setSelected(null);
              reschedule(b, resourceId, startMin);
            }}
          />
        )}
      </dialog>
    </div>
  );
}

function BookingDetails({
  booking: b,
  columns,
  canManage,
  busy,
  onClose,
  onStatus,
  onReschedule,
}: {
  booking: BoardBooking;
  columns: BoardColumn[];
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onStatus: (s: BookingStatus) => void;
  onReschedule: (resourceId: string, startMin: number) => void;
}) {
  const next = canManage ? panelTransitions(b.status) : [];
  const targets = columns.filter((c) => c.canManage);
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="detalhe-titulo" className="text-heading font-semibold">
            {b.customerName}
          </h2>
          <p className="text-body text-muted">
            {b.offeringName} ·{" "}
            <span className="tabular">
              {hhmm(b.startMin)} – {hhmm(b.endMin)}
            </span>{" "}
            · {b.priceLabel}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            {b.fromMarketplace && (
              <span className="text-caption text-muted">veio do marketplace</span>
            )}
            {b.customerConfirmed && (
              <span className="flex items-center gap-1 text-caption font-semibold text-status-confirmed-fg">
                <CheckCheck aria-hidden className="size-4" strokeWidth={2} />
                Presença confirmada pelo cliente
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}>
          <X aria-hidden strokeWidth={2} />
        </Button>
      </div>

      {next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {next.map((s) => (
            <Button
              key={s}
              variant={
                s === "CANCELLED"
                  ? "outline"
                  : s === "COMPLETED" || s === "CONFIRMED"
                    ? "brand"
                    : "outline"
              }
              disabled={busy}
              onClick={() => onStatus(s)}
            >
              {b.status === "COMPLETED" || b.status === "NO_SHOW" ? "Desfazer" : ACTION_LABEL[s]}
            </Button>
          ))}
        </div>
      )}

      {canManage && isMovable(b) && (
        <form
          className="flex flex-col gap-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const [h, m] = String(f.get("hora")).split(":").map(Number);
            onReschedule(String(f.get("recurso")), h * 60 + m);
          }}
        >
          <h3 className="text-body font-semibold">Remarcar</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-body font-medium">
              Horário
              <input
                name="hora"
                type="time"
                step={SNAP * 60}
                required
                defaultValue={hhmm(b.startMin)}
                className="h-11 rounded-control border border-border-strong bg-surface px-3 tabular"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-body font-medium">
              Com
              <select
                name="recurso"
                defaultValue={b.resourceId}
                className="h-11 rounded-control border border-border-strong bg-surface px-3"
              >
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            Salvar novo horário
          </Button>
          <p className="text-caption text-muted">
            Dica: você também pode arrastar o bloco na agenda.
          </p>
        </form>
      )}
    </div>
  );
}
