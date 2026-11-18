-- =============================================================================
-- Resolução de tenant pelo Host e acesso às tabelas de autenticação.
-- =============================================================================

-- 1. Better Auth (tabelas globais criadas em 0002_auth) ------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications TO marcai_app;

-- 2. Resolver tenant ANTES de existir contexto --------------------------------
-- O proxy recebe só o Host. Para descobrir o tenant ele precisa ler tenants e
-- domains, que estão sob RLS. Estas funções são a única porta para isso:
-- SECURITY DEFINER pertencentes a marcai_public (BYPASSRLS), devolvendo apenas
-- campos públicos. search_path fixo evita sequestro por objetos de outro schema.

CREATE FUNCTION resolve_tenant_by_slug(p_slug text)
RETURNS TABLE (tenant_id uuid, slug text, name text, brand_color text, status tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.slug::text, t.name, t.brand_color::text, t.status
    FROM tenants t
   WHERE t.slug = lower(p_slug)
$$;

-- Domínio customizado: só conta depois de verificado.
CREATE FUNCTION resolve_tenant_by_host(p_host text)
RETURNS TABLE (tenant_id uuid, slug text, name text, brand_color text, status tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.slug::text, t.name, t.brand_color::text, t.status
    FROM domains d
    JOIN tenants t ON t.id = d.tenant_id
   WHERE d.host = lower(p_host) AND d.verified
$$;

-- Negócios em que o usuário atual (app.user_id) tem membership.
-- Usado na tela pós-login "Escolha o negócio". Sem app.user_id, retorna vazio.
CREATE FUNCTION my_memberships()
RETURNS TABLE (tenant_id uuid, slug text, name text, role membership_role)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.slug::text, t.name, m.role
    FROM memberships m
    JOIN tenants t ON t.id = m.tenant_id
   WHERE m.user_id = app_current_user()
   ORDER BY t.name
$$;

GRANT SELECT ON domains, memberships TO marcai_public;
GRANT EXECUTE ON FUNCTION app_current_user() TO marcai_public;

ALTER FUNCTION resolve_tenant_by_slug(text) OWNER TO marcai_public;
ALTER FUNCTION resolve_tenant_by_host(text) OWNER TO marcai_public;
ALTER FUNCTION my_memberships() OWNER TO marcai_public;

REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text), resolve_tenant_by_host(text), my_memberships()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text), resolve_tenant_by_host(text), my_memberships()
  TO marcai_app;
