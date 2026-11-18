-- =============================================================================
-- Segurança e integridade que o schema TS não expressa.
-- Pré-requisitos (criados por scripts/db/setup.ts como superusuário):
--   extensões postgis e btree_gist; papéis marcai_migrator (dono, roda isto),
--   marcai_app (aplicação, sem BYPASSRLS) e marcai_public (dono da view pública,
--   BYPASSRLS, NOLOGIN).
-- =============================================================================

-- 1. Anti double-booking ------------------------------------------------------
-- Dois bookings ativos no mesmo recurso não podem ter períodos sobrepostos.
-- Períodos são [início, fim): 18:00-18:30 e 18:30-19:00 NÃO se sobrepõem.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (resource_id WITH =, period WITH &&)
  WHERE (status IN ('PENDING_PAYMENT', 'CONFIRMED'));

-- 2. Contexto da requisição ---------------------------------------------------
-- A aplicação faz, em cada transação:
--   SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)
-- (true = local à transação; some no COMMIT/ROLLBACK, seguro com pool de conexões).
-- Sem contexto, as funções retornam NULL e nenhuma linha de tenant é visível.
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- 3. Row Level Security -------------------------------------------------------
-- ENABLE liga o RLS; FORCE faz valer também para o dono das tabelas
-- (marcai_migrator). Nenhum papel de aplicação tem BYPASSRLS.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'domains', 'locations', 'resources', 'offerings', 'offering_resources',
    'availability_rules', 'availability_exceptions', 'pricing_rules',
    'customer_profiles', 'memberships', 'recurring_bookings', 'bookings',
    'payments', 'subscriptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant())
         WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- A própria linha do tenant segue a mesma regra (chave é id, não tenant_id).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- Conta global: o cliente lê os próprios bookings em qualquer tenant ("Meus agendamentos").
-- Só leitura; escrever continua exigindo o contexto do tenant.
CREATE POLICY customer_reads_own ON bookings FOR SELECT
  USING (customer_id = app_current_user());

-- O usuário vê as próprias memberships (para escolher qual negócio gerenciar).
CREATE POLICY member_reads_own ON memberships FOR SELECT
  USING (user_id = app_current_user());

-- 4. Privilégios da aplicação -------------------------------------------------
GRANT USAGE ON SCHEMA public TO marcai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO marcai_app;
-- Auditoria é append-only.
REVOKE UPDATE, DELETE ON audit_logs FROM marcai_app;
GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO marcai_app;

-- 5. Vitrine pública do marketplace -------------------------------------------
-- Única porta de leitura entre tenants. A view pertence a marcai_public
-- (BYPASSRLS), expõe só colunas públicas e só tenants listados e ativos.
-- security_barrier impede que filtros do chamador vazem linhas escondidas.
CREATE VIEW public_listings WITH (security_barrier = true) AS
SELECT
  t.id            AS tenant_id,
  t.slug,
  t.name,
  t.niche,
  t.brand_color,
  t.logo_url,
  l.id            AS location_id,
  l.neighborhood,
  l.city,
  l.state_code,
  l.geo,
  l.timezone,
  (SELECT min(o.base_price_cents)
     FROM offerings o
    WHERE o.tenant_id = t.id AND o.active) AS starting_price_cents,
  (SELECT bool_and(o.mode = 'RENTAL')
     FROM offerings o
    WHERE o.tenant_id = t.id AND o.active) AS is_rental
FROM tenants t
JOIN locations l ON l.tenant_id = t.id
WHERE t.listed_on_marketplace AND t.status = 'ACTIVE';

GRANT SELECT ON tenants, locations, offerings TO marcai_public;
ALTER VIEW public_listings OWNER TO marcai_public;
GRANT SELECT ON public_listings TO marcai_app;
