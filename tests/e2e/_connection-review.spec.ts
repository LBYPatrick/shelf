import { mkdir } from 'node:fs/promises';
import { test } from './fixtures';
import { setAppearance } from '../ui/fixtures';

test('review the connection workspace in both themes', async ({ app, page }) => {
  await mkdir('/tmp/shelf-connection-review', { recursive: true });
  await setAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1000, 700)
  );
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  const shot = async (name: string) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/shelf-connection-review/${name}.png` });
  };
  await shot('welcome-dark');
  await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await shot('postgres-dark');
  await page.getByRole('radio', { name: 'SQLite', exact: true }).click();
  await shot('file-dark');
  await setAppearance(page, 'light');
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'SQLite', exact: true }).click();
  await shot('file-light');
  await page.getByRole('radio', { name: 'DynamoDB', exact: true }).click();
  await shot('dynamo-light');
});
