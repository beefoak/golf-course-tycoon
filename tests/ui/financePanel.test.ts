// @vitest-environment happy-dom
import { financeTool } from '../../src/ui/panels/financePanel';
import { statementFor } from '../../src/sim/economy/reports';
import { addClubhouse, threeHoleCourse } from '../sim/golfers/courseFixture';
import { money } from '../../src/ui/dom';

test('60 days on: the year statement\'s change in cash matches the cash, and the loan tab borrows', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  const before = statementFor(g, null, 0, g.day).cashChange;
  const cash0 = g.ledger.cash;
  const end = g.day + 60;
  while (g.day < end) g.tick();
  const tool = financeTool(g);
  const box = tool.panel!() as HTMLElement;
  document.body.append(box);
  const click = (text: string) => { [...box.querySelectorAll('button')].find(b => b.textContent === text)!.click(); };
  click('Year');
  const rowValue = (label: string) => [...box.querySelectorAll('.row')].find(r => r.firstChild?.textContent === label)?.lastChild?.textContent;
  // the year so far covers every day since the start, including the fixture's own spending
  const year = statementFor(g, null, 1, g.day).cashChange;
  expect(rowValue('Change in cash')).toBe(money(year));
  expect(year - before).toBe(g.ledger.cash - cash0);
  expect(Number(rowValue('Total revenue')!.replace(/[$,]/g, ''))).toBeGreaterThan(0);

  click('Holes');
  expect(box.querySelectorAll('table tr').length).toBe(1 + course.holes.length);
  click('Loans');
  const cash = g.ledger.cash;
  click('Borrow');
  expect(g.ledger.cash).toBe(cash + 100_000);
  expect(box.textContent).toContain('Loan #1');
  click('Cash');
  expect(box.querySelector('canvas, .muted')).not.toBeNull();
});
