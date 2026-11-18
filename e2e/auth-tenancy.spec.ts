/**
 * Etapa 3 de ponta a ponta: roteamento por Host, login por e-mail mágico com
 * cookie compartilhado entre subdomínios e guards de papel.
 * Usa o banco de dev com o seed (pnpm db:seed roda no webServer).
 */
import { expect, test } from "@playwright/test";
import { E2E_ROOT } from "./env";
import { root, signIn, tenant } from "./helpers";

test.describe("roteamento por host", () => {
  test("subdomínio do tenant abre a página dele com a cor da marca", async ({ page }) => {
    await page.goto(tenant("navalha"));
    await expect(page.getByRole("heading", { level: 1, name: "Barbearia Navalha" })).toBeVisible();
    const brand = await page
      .locator("[data-tenant=navalha]")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());
    expect(brand.toUpperCase()).toBe("#7A4E24");
  });

  test("subdomínio inexistente dá 404", async ({ page }) => {
    const res = await page.goto(tenant("nao-existe"));
    expect(res?.status()).toBe(404);
  });

  test("rotas internas não são alcançáveis pela URL", async ({ page }) => {
    expect((await page.goto(root("/t/navalha")))?.status()).toBe(404);
    expect((await page.goto(root("/admin")))?.status()).toBe(404);
    expect((await page.goto(tenant("navalha", "/t/arenabeirario/painel")))?.status()).toBe(404);
  });

  test("login e API de auth só existem na raiz", async ({ page }) => {
    expect((await page.goto(tenant("navalha", "/entrar")))?.status()).toBe(404);
    expect((await page.goto(tenant("navalha", "/api/auth/get-session")))?.status()).toBe(404);
  });
});

test.describe("login e papéis", () => {
  test("dono entra pelo painel do tenant e volta para ele já logado", async ({ page }) => {
    await signIn(page, "rafa@navalha.dev", tenant("navalha", "/painel"));
    await expect(page).toHaveURL(tenant("navalha", "/painel"));
    await expect(page.getByRole("heading", { name: "Olá, Rafa" })).toBeVisible();
    await expect(page.getByText("Dono", { exact: true })).toBeVisible();
    await expect(page.getByText("billing:manage")).toBeVisible();

    // Mesma sessão vale em outro subdomínio, mas sem membership lá: sem acesso.
    await page.goto(tenant("arenabeirario", "/painel"));
    await expect(
      page.getByRole("heading", { name: "Você não tem acesso a esta área" }),
    ).toBeVisible();

    // E não é super admin.
    await page.goto(`http://admin.${E2E_ROOT}/`);
    await expect(
      page.getByRole("heading", { name: "Você não tem acesso a esta área" }),
    ).toBeVisible();

    // "Seus negócios" na raiz lista só a Navalha.
    await page.goto(root("/negocios"));
    await expect(page.getByRole("link", { name: /Barbearia Navalha/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Arena Beira-Rio/ })).toHaveCount(0);
  });

  test("STAFF só tem permissões da própria agenda", async ({ page }) => {
    await signIn(page, "diego@navalha.dev", tenant("navalha", "/painel"));
    await expect(page.getByText("Equipe", { exact: true })).toBeVisible();
    await expect(page.getByText("agenda:manage_own")).toBeVisible();
    await expect(page.getByText("agenda:view_all")).toHaveCount(0);
  });

  test("super admin entra no backoffice", async ({ page }) => {
    await signIn(page, "admin@marcai.dev", `http://admin.${E2E_ROOT}/`);
    await expect(page.getByRole("heading", { name: "Backoffice" })).toBeVisible();
  });

  test("sair encerra a sessão em todos os subdomínios", async ({ page }) => {
    await signIn(page, "carla@navalha.dev", tenant("navalha", "/painel"));
    await expect(page.getByText("Gerente", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL(root("/"));
    await page.goto(tenant("navalha", "/painel"));
    await expect(page).toHaveURL(/\/entrar\?callbackURL=/);
  });
});
