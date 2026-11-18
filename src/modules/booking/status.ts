/** Ordem de exibição (legendas, filtros): segue a identidade v0.1. */
export const BOOKING_STATUSES = [
  "CONFIRMED",
  "PENDING_PAYMENT",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: "Confirmado",
  PENDING_PAYMENT: "Aguardando pagamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

/** Status que ocupam o recurso (mesma lista da exclusion constraint no banco). */
export const BLOCKING_STATUSES: readonly BookingStatus[] = ["PENDING_PAYMENT", "CONFIRMED"];

/** Mudanças de status permitidas a partir do painel. */
const PANEL_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  COMPLETED: ["CONFIRMED"],
  NO_SHOW: ["CONFIRMED"],
  CANCELLED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return PANEL_TRANSITIONS[from].includes(to);
}

export function panelTransitions(from: BookingStatus): BookingStatus[] {
  return PANEL_TRANSITIONS[from];
}
