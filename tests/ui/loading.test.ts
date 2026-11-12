// @vitest-environment happy-dom
import { LOADING_LINES, MIN_LINE_MS, showLoading } from '../../src/ui/loading';

test('the loading card rotates flavour lines and goes away when done', () => {
  vi.useFakeTimers();
  const l = showLoading(document.body, ['Laying sod', 'Placing boulders', 'Filling ponds'], 500, 0);
  expect(document.body.textContent).toContain('Laying sod…');
  // too soon: the first line stays up long enough to read
  l.step();
  expect(l.line()).toBe('Laying sod');
  vi.advanceTimersByTime(MIN_LINE_MS);
  l.step();
  expect(l.line()).toBe('Placing boulders');
  vi.advanceTimersByTime(150);
  expect(l.line()).toBe('Placing boulders');
  vi.advanceTimersByTime(500);
  expect(document.body.textContent).toContain('Filling ponds…');
  vi.advanceTimersByTime(500);
  expect(l.line()).toBe('Laying sod');
  l.done();
  expect(l.el.classList.contains('out')).toBe(true);
  vi.advanceTimersByTime(300);
  expect(document.body.querySelector('.loading')).toBeNull();
  vi.useRealTimers();
});

test('the default lines include the classics', () => {
  for (const s of ['Laying sod', 'Placing boulders', 'Filling ponds']) expect(LOADING_LINES).toContain(s);
});
