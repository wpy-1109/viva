import { expect, test } from "@playwright/test";

test("完成演示知识的同步、审阅、提问和停止", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "知识工程工作台" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/01-overview.png", fullPage: true });
  await page.getByRole("button", { name: "载入演示数据" }).click();
  await expect(page.getByRole("status")).toContainText("演示数据");
  await page.getByRole("link", { name: "来源" }).click();
  await page.getByRole("button", { name: "立即同步" }).click();
  await expect(page.getByRole("status")).toContainText("已同步");
  await page.getByRole("link", { name: "提案" }).click();
  await page.screenshot({ path: "artifacts/screenshots/02-proposal-diff.png", fullPage: true });
  await page.getByRole("button", { name: "通过" }).click();
  await expect(page.getByText("已通过并发布")).toBeVisible();
  await page.getByRole("link", { name: "提问" }).click();
  await page.getByLabel("问题").fill("演示数据说明检索不是向量");
  await page.getByRole("button", { name: "提问" }).click();
  await expect(page.getByRole("heading", { name: "引用" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/03-answer.png", fullPage: true });
  await expect(page.getByText("演示提供者 · 非实时模型")).toBeVisible();
  await page.getByRole("link", { name: "运行" }).click();
  await page.getByRole("button", { name: "启动自动驾驶" }).click();
  await expect(page.getByText("当前期望状态：运行中")).toBeVisible();
  await page.getByRole("button", { name: "停止自动驾驶" }).click();
  await expect(page.getByText("当前期望状态：已停止")).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "运行" }).click();
  await expect(page.getByText("当前期望状态：已停止")).toBeVisible();
  await expect(page.getByRole("button", { name: "启动自动驾驶" })).toBeEnabled();
  await page.screenshot({ path: "artifacts/screenshots/04-runs-stopped.png", fullPage: true });
});

test("真实模型没有密钥时测试连接会失败", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("提供者").selectOption("live");
  await page.getByRole("button", { name: "保存模型" }).click();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("status")).toContainText("missing_config");
  await expect(page.getByRole("status")).not.toContainText("【演示提供者·非实时模型】");
  await page.screenshot({ path: "artifacts/screenshots/06-missing-credential.png", fullPage: true });
  await page.getByLabel("提供者").selectOption("demo");
  await page.getByRole("button", { name: "保存模型" }).click();
});

test("来源变更后可以看差异、通过并回滚，反馈会生成下一份提案", async ({ page }) => {
  const { appendFileSync } = await import("node:fs");
  appendFileSync("data/e2e/demo-corpus/readme.md", "\n第二版补充了回滚前要核对的句子。\n");
  await page.goto("/#/sources");
  await page.getByRole("button", { name: "立即同步" }).click();
  await page.getByRole("link", { name: "提案" }).click();
  await expect(page.getByText("已过期").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/07-revision-diff.png", fullPage: true });
  await page.getByRole("button", { name: "按基线发布" }).click();
  await page.getByRole("button", { name: "回滚" }).click();
  await expect(page.getByText("已回滚到上一版")).toBeVisible();
  await page.getByRole("link", { name: "提问" }).click();
  await page.getByLabel("问题").fill("演示数据说明检索不是向量");
  await page.getByRole("button", { name: "提问" }).click();
  await page.getByLabel("这条回答哪里不对").fill("请补充回滚后的核对步骤");
  await page.getByRole("button", { name: "提交反馈" }).click();
  await expect(page.getByRole("status")).toContainText("待审提案");
  await page.getByRole("link", { name: "提案" }).click();
  await expect(page.getByRole("heading", { name: "来自使用反馈的修订候选" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/08-feedback-proposal.png", fullPage: true });
});

test("键盘第一个焦点是跳到主要内容", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
});

test("窄屏可以到达来源和提问", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("link", { name: "来源" }).click();
  await expect(page.getByRole("heading", { name: "来源" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/05-mobile-sources.png", fullPage: true });
});
