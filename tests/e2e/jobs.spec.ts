import { expect, test } from './fixtures';
import { dispatchQuery, typeQuery } from './helpers';

/**
 * Finding one job among the hundred that are kept.
 *
 * The list is a log, and a log is read by searching it: the field takes the
 * name, and a chip per condition takes the questions a name cannot answer. The
 * predicate itself is unit tested — this is about the wiring, which is the part
 * unit tests cannot see: the field reaching the store, a chip reaching the same
 * filter, the switch on a chip parking a condition rather than discarding it,
 * and the count telling the truth about a list that is quietly missing rows.
 */
test('searches jobs by name, narrows them by status and length, and says so', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole('button', { name: /new query/i })
    .first()
    .click();
  await typeQuery(page, 'select id, name from music.artist');
  await dispatchQuery(page);

  await page.getByRole('button', { name: 'Jobs' }).click();
  const cards = page.locator('.joblist .tile');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('.job__status')).toHaveText(/Done/, { timeout: 20_000 });

  // The two facts a finished job is looked back at for are on the card itself,
  // not only in the name it was given — which is the first thing a rename
  // throws away.
  /*
   * One line that never wraps. "Started …" moved to the hover label when the
   * tiles were made one shape: five facts laid out to fit meant they sometimes
   * did not, and that card stood taller than its neighbours.
   */
  await expect(cards.first().locator('.tile__meta')).toContainText('took');

  // A name of its own, so the search is looking for something a reader chose.
  await cards.first().locator('.tile__name').dblclick();
  const rename = page.getByLabel('Rename');
  await rename.fill('june refunds');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(cards.first().locator('.tile__name')).toHaveText('june refunds');

  const find = page.getByPlaceholder('Find a job');
  await find.fill('refund');
  await expect(cards).toHaveCount(1);

  // Nothing matched is a different fact from nothing existing, and the way back
  // is on the same surface that is missing the rows.
  await find.fill('invoices');
  await expect(cards).toHaveCount(0);
  await expect(page.locator('.joblist__empty')).toContainText('No job matches');
  await page.getByRole('button', { name: 'Clear the filters' }).click();
  await expect(cards).toHaveCount(1);
  await expect(find).toHaveValue('');

  // A condition is a chip, added through one popup that asks what and then
  // which — because "status" on its own is not a filter, and sending the reader
  // to a second menu asks the same question twice.
  await page.getByRole('button', { name: /add a filter/i }).click();
  await page.getByRole('button', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: 'Failed', exact: true }).click();

  const chips = page.locator('.chip');
  await expect(chips).toHaveCount(1);
  await expect(cards).toHaveCount(0);
  await expect(page.locator('.joblist__tally')).toContainText('0 of 1');

  /*
   * Clicking the body parks the condition without forgetting it — the whole
   * reason a chip beats a dropdown that only knows "any". The list comes back
   * and the chip is still there, crossed out.
   */
  await chips.first().locator('.chip__body').click();
  await expect(chips.first()).toHaveClass(/chip--off/);
  await expect(cards).toHaveCount(1);

  await chips.first().locator('.chip__body').click();
  await expect(cards).toHaveCount(0);

  // The cross discards it, which is the other gesture.
  await chips.first().locator('.chip__drop').click();
  await expect(chips).toHaveCount(0);
  await expect(cards).toHaveCount(1);

  // A second dimension narrows rather than widens: a job that finished in
  // milliseconds is not one that took over a minute, whatever its status.
  await page.locator('.chips__button').click();
  await page.getByRole('button', { name: 'Took', exact: true }).click();
  await page.getByRole('button', { name: 'Over a minute', exact: true }).click();
  await expect(cards).toHaveCount(0);

  // ...and the window it did run in finds it again.
  await chips.first().locator('.chip__drop').click();
  await page.locator('.chips__button').click();
  await page.getByRole('button', { name: 'Started', exact: true }).click();
  await page.getByRole('button', { name: 'Last hour', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.locator('.joblist__tally')).toContainText('1 of 1');
});
