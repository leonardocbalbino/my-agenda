import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_ROOT } from "./env";

const PAGES = [
  "/",
  "/design",
  "/entrar",
  "/sem-acesso",
  `http://navalha.${E2E_ROOT}/`,
  `http://arenabeirario.${E2E_ROOT}/`,
  "/explorar",
];

for (const path of PAGES) {
  test(`${path} não tem violações de acessibilidade (WCAG 2.2 AA)`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}
test("alvos de toque interativos têm pelo menos 44px", async ({ page }) => {
  await page.goto("/design");
  const small = await page.$$eval("main button, main a", (els) =>
    els
      // Isentos: links em texto corrido e o link "esticado" do card (o ::after cobre o card todo).
      .filter((el) => !el.closest("p") && !el.classList.contains("card-link"))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent?.trim(), w: r.width, h: r.height };
      })
      .filter((r) => r.w > 0 && (r.h < 44 || r.w < 44)),
  );
  expect(small).toEqual([]);
});
