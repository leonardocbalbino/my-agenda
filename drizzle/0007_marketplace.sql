-- =============================================================================
-- Marketplace: a vitrine pública ganha o que a busca precisa.
-- CREATE OR REPLACE só pode acrescentar colunas no fim (as antigas ficam iguais).
-- =============================================================================

CREATE OR REPLACE VIEW public_listings WITH (security_barrier = true) AS
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
    WHERE o.tenant_id = t.id AND o.active) AS is_rental,
  -- Novos: nomes dos serviços ativos (busca "O quê") e o serviço vitrine do card
  -- (o mais barato; empate pela ordem do cardápio).
  (SELECT coalesce(array_agg(o.name ORDER BY o.sort_order), '{}')
     FROM offerings o
    WHERE o.tenant_id = t.id AND o.active) AS offering_names,
  (SELECT o.id
     FROM offerings o
    WHERE o.tenant_id = t.id AND o.active
      AND EXISTS (SELECT 1 FROM offering_resources r WHERE r.offering_id = o.id)
    ORDER BY o.base_price_cents, o.sort_order
    LIMIT 1) AS headline_offering_id
FROM tenants t
JOIN locations l ON l.tenant_id = t.id
WHERE t.listed_on_marketplace AND t.status = 'ACTIVE';

GRANT SELECT ON offering_resources TO marcai_public;
