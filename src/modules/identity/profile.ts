import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { normalizeBRPhone } from "@/lib/phone";

export interface ReminderPrefs {
  phone: string | null;
  whatsappOptIn: boolean;
}

export async function getReminderPrefs(db: Db, userId: string): Promise<ReminderPrefs> {
  const [u] = await db
    .select({ phone: users.phone, optIn: users.whatsappOptInAt })
    .from(users)
    .where(eq(users.id, userId));
  return { phone: u?.phone ?? null, whatsappOptIn: Boolean(u?.optIn && u.phone) };
}

/** Ativa lembretes no WhatsApp com aceite explícito (LGPD). Retorna false se o telefone é inválido. */
export async function enableWhatsAppReminders(db: Db, userId: string, rawPhone: string) {
  const phone = normalizeBRPhone(rawPhone);
  if (!phone) return false;
  await db
    .update(users)
    .set({ phone, whatsappOptInAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  return true;
}

export async function disableWhatsAppReminders(db: Db, userId: string) {
  await db
    .update(users)
    .set({ whatsappOptInAt: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
