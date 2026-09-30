import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

const env = {
  ...process.env,
  WORKBENCH_USER_DATA: resolve(`.runtime/tooltip-qa-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
let testError;
try {
  app = await electron.launch({ args: [".", "--disable-gpu"], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("Renderer error:", error));
  const button = page.locator(".new-connection-button");
  await expect(button).toBeVisible({ timeout: 30000 });

  const expectedText = await button.getAttribute("title");
  expect(expectedText).toBeTruthy();
  await button.hover();
  const tooltip = page.locator(".app-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(expectedText);
  await expect(button).not.toHaveAttribute("title");
  await expect(button).toHaveAttribute("data-irwin-tooltip", expectedText);
  const tooltipBox = await tooltip.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height);

  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
  await expect(button).toHaveAttribute("title", expectedText);
  await expect(button).not.toHaveAttribute("data-irwin-tooltip");

  await button.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(expectedText);
  const describedBy = await button.getAttribute("aria-describedby");
  expect(describedBy).toContain(await tooltip.getAttribute("id"));

  await button.evaluate((element) => element.blur());
  await expect(tooltip).toBeHidden();
  await expect(button).toHaveAttribute("title", expectedText);
  await expect(button).not.toHaveAttribute("aria-describedby", /irwin-tooltip/);
  console.log("PASS custom tooltips show on hover and keyboard focus");
} catch (error) {
  testError = error;
} finally {
  if (app) {
    try {
      await closeElectronWindowNormally(app);
    } catch (closeError) {
      if (!testError) testError = closeError;
    }
  }
}
if (testError) throw testError;
