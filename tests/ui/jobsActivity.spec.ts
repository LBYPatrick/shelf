import { test, expect } from './fixtures';
import type { Job } from '../../src/renderer/stores/jobs';

/** Seed concurrent statuses at the store seam; real dispatch is covered by e2e/jobs. */
test('job activity follows concurrent jobs, live tooltips, failures and reduced motion', async ({
  sample,
}) => {
  const activity = sample.getByRole('button', { name: 'Job activity', exact: true });
  const setJobs = async (statuses: Job['status'][]) => {
    await sample.evaluate((statuses) => {
      const root = document.querySelector('#app') as HTMLElement & {
        __vue_app__: {
          config: { globalProperties: { $pinia: { _s: Map<string, { jobs: Job[] }> } } };
        };
      };
      root.__vue_app__.config.globalProperties.$pinia._s.get('jobs')!.jobs = statuses.map(
        (status, index) => ({
          id: `activity-${index}`,
          name: `Job ${index}`,
          connectionId: 'sample',
          database: 'sample',
          sql: 'select 1',
          status,
          rows: 0,
          fields: [],
          startedAt: Date.now(),
        })
      );
    }, statuses);
  };
  const edge = await activity.boundingBox();
  const strip = await sample.locator('.strip').boundingBox();
  expect(strip!.x + strip!.width - (edge!.x + edge!.width)).toBeLessThanOrEqual(12);
  await sample.keyboard.press('Tab');
  await activity.focus();
  await expect(sample.locator('.hovertip')).toHaveText('Jobs · 0 in progress');
  await setJobs(['running', 'pending']);
  await expect(activity.locator('.job-activity__count')).toHaveText('2');
  await expect(sample.locator('.hovertip')).toHaveText('Jobs · 2 in progress');
  await expect(activity.locator('.job-activity__running')).toBeVisible();
  await setJobs(['failed', 'running']);
  await expect(sample.locator('.hovertip')).toHaveText('Jobs · 1 in progress');
  await setJobs(['failed', 'done']);
  await expect(activity.locator('.job-activity__failure')).toBeVisible();
  await expect(activity.locator('.job-activity__success')).toHaveCount(0);
  await expect(sample.locator('.hovertip')).toHaveText('Jobs · 0 in progress · A job failed');
  await setJobs(['running']);
  await expect(activity.locator('.job-activity__running')).toBeVisible();
  await setJobs(['done']);
  await expect(activity.locator('.job-activity__success')).toBeVisible();
  await expect(sample.locator('.hovertip')).toHaveText('Jobs · 0 in progress · Finished');
  await expect(activity.locator('.job-activity__success')).toHaveCount(0, { timeout: 5000 });
  await expect(sample.locator('.hovertip')).toHaveText('Jobs · 0 in progress');
  await sample.emulateMedia({ reducedMotion: 'reduce' });
  await setJobs(['running']);
  const spinner = activity.locator('.job-activity__running');
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none'
  );
  await setJobs(['done']);
  await expect(activity.locator('.job-activity__success')).toBeVisible();
  await activity.click();
  await expect(sample.locator('.joblist')).toBeVisible();
});
