-- =============================================================================
-- Lembretes: RLS do registro de envios e funções do worker / webhook.
-- Todas as funções entre tenants pertencem a marcai_jobs (NOLOGIN, BYPASSRLS)
-- e fazem uma coisa só.
-- =============================================================================

-- 1. Registro de envios: isolado por tenant como as outras tabelas.
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_log
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON notification_log TO marcai_app;

-- 2. O que precisa ser enviado agora, em todos os tenants.
--   CONFIRMATION  logo após confirmar (ou remarcar), se faltam mais de 15 min
--   REMINDER_24H  entre 24h e 2h antes, se o horário foi marcado com 22h+ de antecedência
--   REMINDER_2H   entre 2h e 15 min antes, se o horário foi marcado com 3h+ de antecedência
-- Telefone só com consentimento (LGPD); sem ele, cai para o e-mail.
CREATE FUNCTION due_notifications(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 200)
RETURNS TABLE (
  booking_id uuid,
  tenant_id uuid,
  kind notification_kind,
  booking_start timestamptz,
  booking_end timestamptz,
  tenant_slug text,
  tenant_name text,
  offering_name text,
  resource_name text,
  timezone text,
  customer_name text,
  phone text,
  email text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH active AS (
    SELECT b.id, b.tenant_id, lower(b.period) AS s, upper(b.period) AS e, b.period_changed_at AS changed
      FROM bookings b
     WHERE b.status = 'CONFIRMED'
       AND lower(b.period) > p_now
       -- Lembretes só olham as próximas 25h; confirmações, o que mudou nas últimas 6h.
       AND (lower(b.period) < p_now + interval '25 hours'
            OR b.period_changed_at >= p_now - interval '6 hours')
  ),
  due AS (
    SELECT a.*, 'CONFIRMATION'::notification_kind AS kind
      FROM active a
     WHERE a.changed >= p_now - interval '6 hours'
       AND a.s > p_now + interval '15 minutes'
    UNION ALL
    SELECT a.*, 'REMINDER_24H'::notification_kind
      FROM active a
     WHERE p_now >= a.s - interval '24 hours'
       AND p_now <  a.s - interval '2 hours'
       AND a.changed <= a.s - interval '22 hours'
    UNION ALL
    SELECT a.*, 'REMINDER_2H'::notification_kind
      FROM active a
     WHERE p_now >= a.s - interval '2 hours'
       AND p_now <  a.s - interval '15 minutes'
       AND a.changed <= a.s - interval '3 hours'
  )
  SELECT d.id, d.tenant_id, d.kind, d.s, d.e,
         t.slug::text, t.name, o.name, r.name, l.timezone,
         cp.name,
         CASE
           WHEN cp.whatsapp_opt_in_at IS NOT NULL AND cp.phone IS NOT NULL THEN cp.phone::text
           WHEN u.whatsapp_opt_in_at IS NOT NULL AND u.phone IS NOT NULL THEN u.phone::text
         END,
         coalesce(u.email, cp.email)
    FROM due d
    JOIN bookings b          ON b.id = d.id
    JOIN tenants t           ON t.id = d.tenant_id
    JOIN offerings o         ON o.id = b.offering_id
    JOIN resources r         ON r.id = b.resource_id
    JOIN locations l         ON l.id = r.location_id
    JOIN customer_profiles cp ON cp.id = b.customer_profile_id
    LEFT JOIN users u        ON u.id = b.customer_id
   WHERE t.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM notification_log n
        WHERE n.booking_id = d.id AND n.kind = d.kind AND n.booking_start = d.s
     )
   ORDER BY d.s
   LIMIT p_limit
$$;

-- 3. Resposta a um botão do lembrete ("Confirmo presença" / "Preciso remarcar").
-- Só vale se o telefone que respondeu é o da reserva (em qualquer das variantes
-- com/sem 9º dígito, calculadas pela aplicação). CONFIRM grava a presença.
CREATE FUNCTION whatsapp_booking_reply(p_booking_id uuid, p_phones text[], p_action text)
RETURNS TABLE (tenant_slug text, tenant_name text, status booking_status, starts_at timestamptz, timezone text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_action NOT IN ('CONFIRM', 'RESCHEDULE') THEN
    RAISE EXCEPTION 'ação inválida';
  END IF;
  IF p_action = 'CONFIRM' THEN
    UPDATE bookings b
       SET customer_confirmed_at = coalesce(b.customer_confirmed_at, now())
      FROM customer_profiles cp
      LEFT JOIN users u ON u.id = cp.user_id
     WHERE b.id = p_booking_id
       AND cp.id = b.customer_profile_id
       AND b.status = 'CONFIRMED'
       AND (cp.phone = ANY (p_phones) OR u.phone = ANY (p_phones));
  END IF;
  RETURN QUERY
    SELECT t.slug::text, t.name, b.status, lower(b.period), l.timezone
      FROM bookings b
      JOIN tenants t ON t.id = b.tenant_id
      JOIN resources r ON r.id = b.resource_id
      JOIN locations l ON l.id = r.location_id
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      LEFT JOIN users u ON u.id = cp.user_id
     WHERE b.id = p_booking_id
       AND (cp.phone = ANY (p_phones) OR u.phone = ANY (p_phones));
END
$$;

-- 4. "PARAR": tira o consentimento desse telefone em todo lugar.
CREATE FUNCTION whatsapp_opt_out(p_phones text[])
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer := 0;
  k integer;
BEGIN
  UPDATE users SET whatsapp_opt_in_at = NULL
   WHERE phone = ANY (p_phones) AND whatsapp_opt_in_at IS NOT NULL;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE customer_profiles SET whatsapp_opt_in_at = NULL
   WHERE phone = ANY (p_phones) AND whatsapp_opt_in_at IS NOT NULL;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END
$$;

GRANT SELECT ON tenants, offerings, resources, locations, customer_profiles, users, notification_log
  TO marcai_jobs;
GRANT UPDATE (customer_confirmed_at) ON bookings TO marcai_jobs;
GRANT UPDATE (whatsapp_opt_in_at) ON users, customer_profiles TO marcai_jobs;

ALTER FUNCTION due_notifications(timestamptz, integer) OWNER TO marcai_jobs;
ALTER FUNCTION whatsapp_booking_reply(uuid, text[], text) OWNER TO marcai_jobs;
ALTER FUNCTION whatsapp_opt_out(text[]) OWNER TO marcai_jobs;

REVOKE ALL ON FUNCTION due_notifications(timestamptz, integer),
                       whatsapp_booking_reply(uuid, text[], text),
                       whatsapp_opt_out(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION due_notifications(timestamptz, integer),
                          whatsapp_booking_reply(uuid, text[], text),
                          whatsapp_opt_out(text[]) TO marcai_app;
