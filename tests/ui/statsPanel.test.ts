// @vitest-environment happy-dom
import { statsPanel } from '../../src/ui/panels/statsPanel';
import { membershipsOf } from '../../src/sim/business/memberships';
import { addClubhouse, threeHoleCourse } from '../sim/golfers/courseFixture';

test('the course panel sets price bands and adds membership tiers', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  const render = (): HTMLElement => statsPanel(g, course.id, () => { el = render(); });
  let el = render();
  expect(el.textContent).toContain('Price bands');
  // twilight band input is the third % input
  const pcts = [...el.querySelectorAll('input[type=number][step="5"]')] as HTMLInputElement[];
  expect(pcts.length).toBe(4);
  pcts[2]!.value = '50';
  pcts[2]!.dispatchEvent(new Event('change'));
  expect(g.pricing.get(course.id)?.bands?.twilight).toBe(0.5);
  // dynamic pricing is off-limits without a general manager
  expect((el.querySelector('input[type=checkbox]') as HTMLInputElement).disabled).toBe(true);
  const add = [...el.querySelectorAll('button')].find(b => b.textContent === '+ Add tier')!;
  add.click();
  expect(membershipsOf(g, course.id).tiers.length).toBe(1);
  expect(el.textContent).toContain('0 members');
});
