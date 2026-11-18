-- =============================================================================
-- Expiração de reservas pendentes e "Meus agendamentos".
-- Pré-requisito: papel marcai_jobs (NOLOGIN, BYPASSRLS), criado por db:setup.
-- =============================================================================

-- 1. Varredura de segurança: cancela TODAS as pendências vencidas, de qualquer tenant.
-- O caminho principal é um job por reserva (no contexto do tenant); esta função
-- cobre jobs perdidos. Faz exatamente um UPDATE e devolve o que mudou.
CREATE FUNCTION expire_pending_bookings(p_now timestamptz DEFAULT now())
RETURNS TABLE (booking_id uuid, tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH expired AS (
    UPDATE bookings b
       SET status = 'CANCELLED',
           cancelled_at = p_now,
           cancel_reason = 'PAYMENT_EXPIRED',
           updated_at = p_now
     WHERE b.status = 'PENDING_PAYMENT'
       AND b.expires_at <= p_now
    RETURNING b.id, b.tenant_id, b.recurring_booking_id
  ),
  recurring AS (
    -- Mensalista cujo primeiro pagamento não caiu também é cancelado.
    UPDATE recurring_bookings r
       SET status = 'CANCELLED', updated_at = p_now
     WHERE r.id IN (SELECT recurring_booking_id FROM expired WHERE recurring_booking_id IS NOT NULL)
       AND r.status = 'ACTIVE'
    RETURNING r.id
  )
  SELECT e.id, e.tenant_id FROM expired e
$$;

GRANT SELECT, UPDATE ON bookings, recurring_bookings TO marcai_jobs;
ALTER FUNCTION expire_pending_bookings(timestamptz) OWNER TO marcai_jobs;
REVOKE ALL ON FUNCTION expire_pending_bookings(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_pending_bookings(timestamptz) TO marcai_app;

-- 2. "Meus agendamentos": reservas do usuário atual (app.user_id) em qualquer
-- tenant, já com nomes legíveis. Sem app.user_id, retorna vazio.
CREATE FUNCTION my_bookings()
RETURNS TABLE (
  booking_id uuid,
  tenant_slug text,
  tenant_name text,
  offering_name text,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  status booking_status,
  price_cents integer,
  prepaid_cents integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, t.slug::text, t.name, o.name, r.name,
         lower(b.period), upper(b.period), l.timezone,
         b.status, b.price_cents, b.prepaid_cents
    FROM bookings b
    JOIN tenants t   ON t.id = b.tenant_id
    JOIN offerings o ON o.id = b.offering_id
    JOIN resources r ON r.id = b.resource_id
    JOIN locations l ON l.id = r.location_id
   WHERE b.customer_id = app_current_user()
   ORDER BY lower(b.period) DESC
$$;

GRANT SELECT ON bookings, resources TO marcai_public;
ALTER FUNCTION my_bookings() OWNER TO marcai_public;
REVOKE ALL ON FUNCTION my_bookings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_bookings() TO marcai_app;
