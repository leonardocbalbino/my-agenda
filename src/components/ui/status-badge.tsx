import { cn } from "@/lib/cn";
import { BOOKING_STATUS_LABEL, type BookingStatus } from "@/modules/booking/status";

const statusClasses: Record<BookingStatus, string> = {
  CONFIRMED: "bg-status-confirmed text-status-confirmed-fg",
  PENDING_PAYMENT: "bg-status-pending text-status-pending-fg",
  COMPLETED: "bg-status-completed text-status-completed-fg",
  CANCELLED: "bg-status-cancelled text-status-cancelled-fg",
  NO_SHOW: "bg-status-no-show text-status-no-show-fg",
};

export interface StatusBadgeProps {
  status: BookingStatus;
  className?: string;
}

/** Cores de status são fixas em toda a plataforma (não seguem a marca do tenant). */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-7 items-center rounded-pill px-3 text-caption font-semibold whitespace-nowrap",
        statusClasses[status],
        className,
      )}
    >
      {BOOKING_STATUS_LABEL[status]}
    </span>
  );
}
