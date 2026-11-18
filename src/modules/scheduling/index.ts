/** Módulo scheduling: regras de disponibilidade, exceções e motor de horários. API pública. */
export { computeSlots, type Slot, type EngineInput } from "./engine";
export {
  AvailabilityError,
  getAvailableSlots,
  nextDays,
  type Availability,
  type AvailabilityQuery,
} from "./availability";
