/**
 * 选片页深链 E2E：依赖 MSW（VITE_USE_MOCK=true）与 handlers 中 proj-demo / ep-001 / shot-001+shot-002。
 */
import { expect, test } from "@playwright/test"

const PICK_SHOT002 = "/project/proj-demo/episode/ep-001/pick?shotId=shot-002"
const PICK_SHOT001 = "/project/proj-demo/episode/ep-001/pick?shotId=shot-001"

test.describe("选片深链", () => {
  test("?shotId= 定位第二镜，消费 query 后仍停留在该镜", async ({ page }) => {
    await page.goto(PICK_SHOT002)
    await expect(page.getByText("当前第 2 / 2")).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/pick(\?.*)?$/)
    await expect(page).not.toHaveURL(/shotId=/)
  })

  test("同集内先后两次 ?shotId= 可切换镜头", async ({ page }) => {
    await page.goto(PICK_SHOT001)
    await expect(page.getByText("当前第 1 / 2")).toBeVisible({ timeout: 20_000 })
    await page.goto(PICK_SHOT002)
    await expect(page.getByText("当前第 2 / 2")).toBeVisible({ timeout: 20_000 })
  })
})
