import { Camera } from '../../src/render/camera';
import { FollowCam } from '../../src/render/follow';
import { createGroup } from '../../src/sim/golfers/groups';
import { golferPosition } from '../../src/sim/golfers/positions';
import { spawnGolfers, threeHoleCourse } from '../sim/golfers/courseFixture';

test('FollowCam moves the camera to the followed golfer and converges within 30 updates', () => {
  const { g, course } = threeHoleCourse();
  const ids = spawnGolfers(g, 2);
  const grp = createGroup(g, course.id, ids, g.day, g.clock.minuteOfDay + 1);
  for (let i = 0; i < 40 && !grp.started; i++) g.tick();
  const cam = new Camera();
  cam.x = 0; cam.y = 0;
  const f = new FollowCam();
  f.target = { kind: 'golfer', id: ids[0]! };
  const target = golferPosition(g, ids[0]!)!;
  const d0 = Math.hypot(cam.x - target.x, cam.y - target.y);
  f.update(cam, g);
  expect(Math.hypot(cam.x - target.x, cam.y - target.y)).toBeLessThan(d0);
  for (let i = 0; i < 29; i++) f.update(cam, g);
  expect(Math.hypot(cam.x - target.x, cam.y - target.y)).toBeLessThan(0.02 * d0 + 0.5);
});

test('following stops when the golfer leaves the course', () => {
  const { g } = threeHoleCourse();
  const f = new FollowCam();
  f.target = { kind: 'golfer', id: 999 };
  const cam = new Camera();
  f.update(cam, g);
  expect(f.target).toBeNull();
});

test('FollowCam can follow a crew member, and stops when they leave the staff', () => {
  const { g, course } = threeHoleCourse();
  g.staff.all.push({ id: 77, courseId: course.id, pos: { x: 40, y: 60 } } as never);
  const cam = new Camera();
  cam.x = 0; cam.y = 0;
  const f = new FollowCam();
  f.target = { kind: 'staff', id: 77 };
  for (let i = 0; i < 40; i++) f.update(cam, g);
  expect(Math.hypot(cam.x - 40, cam.y - 60)).toBeLessThan(0.5);
  g.staff.all = [];
  f.update(cam, g);
  expect(f.target).toBeNull();
});
