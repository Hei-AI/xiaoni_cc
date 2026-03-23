import { expect, test } from '@playwright/test';

test('cognition page renders overview and supports core tab switching', async ({ page }) => {
  await page.goto('/cognition');

  await expect(page.getByRole('heading', { name: '小腻认知视图' })).toBeVisible();
  await expect(page.getByText('来自 agent_observations 的 Phase 1 观察流。这里只读，不改写。')).toBeVisible();

  await page.getByRole('tab', { name: 'Beliefs' }).click();
  await expect(page.getByText('来自 agent_beliefs 的 Phase 1 只读信念视图。')).toBeVisible();

  await page.getByRole('tab', { name: 'Self Model' }).click();
  await expect(page.getByText('查看当前自我模型快照与 internal state 片段是否已经写回数据库。')).toBeVisible();

  await page.getByRole('tab', { name: 'Plans' }).click();
  await expect(page.getByText('查看 weekly_focus、day_plan、followup_queue、micro_intention 的只读状态。')).toBeVisible();
  await expect(page.getByText('直接控制 followup_queue 的运行、暂停、单轮吞吐和白名单，不再只靠容器环境变量。')).toBeVisible();
});
