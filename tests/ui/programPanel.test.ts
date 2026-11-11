// @vitest-environment happy-dom
import { Command } from '../../src/sim/commands';
import { programFor } from '../../src/sim/staff/program';
import { parseHoleList, programPanel } from '../../src/ui/panels/programPanel';
import { newOwnedGame } from '../helpers';

function setup() {
  const g = newOwnedGame();
  const course = g.courses.create('Test');
  const sent: Command[] = [];
  const real = g.dispatch.bind(g);
  g.dispatch = (c: Command) => { sent.push(c); return real(c); };
  let el = programPanel(g, course.id, () => { el = programPanel(g, course.id, () => {}); });
  document.body.replaceChildren(el);
  return { g, courseId: course.id, sent, el: () => el };
}
const change = (input: HTMLInputElement | HTMLSelectElement, v: string) => { input.value = v; input.dispatchEvent(new Event('change')); };

test('editing a rule frequency dispatches setProgramRule with the new value', () => {
  const { g, courseId, sent, el } = setup();
  const freq = el().querySelector<HTMLInputElement>('tr[data-rule="2"] input.freq')!;
  expect(freq).not.toBeNull();
  change(freq, '5');
  const c = sent.at(-1)!;
  expect(c).toMatchObject({ t: 'setProgramRule', courseId, index: 2, rule: { practice: 'mow', frequency: { perWeek: 5 } } });
  expect(programFor(g, courseId).rules[2]!.frequency.perWeek).toBe(5);
});

test('a blank mow height falls back to the course setting; a number pins it', () => {
  const { g, courseId, el } = setup();
  const mm = el().querySelector<HTMLInputElement>('tr[data-rule="0"] input.mm')!;
  change(mm, '3.2');
  expect(programFor(g, courseId).rules[0]!.params?.mowMm).toBe(3.2);
  const mm2 = el().querySelector<HTMLInputElement>('tr[data-rule="0"] input.mm')!;
  change(mm2, '');
  expect(programFor(g, courseId).rules[0]!.params).toBeUndefined();
});

test('an out-of-range frequency is refused with a warning', () => {
  const { g, courseId, el } = setup();
  const msgs: string[] = [];
  g.events.on('notify', n => msgs.push(n.text));
  change(el().querySelector<HTMLInputElement>('tr[data-rule="0"] input.freq')!, '30');
  expect(msgs[0]).toMatch(/14 a week/);
  expect(programFor(g, courseId).rules[0]!.frequency.perWeek).toBe(7);
});

test('hole lists parse ranges', () => {
  expect(parseHoleList('1-3, 7, 10–12')).toEqual([1, 2, 3, 7, 10, 11, 12]);
});
