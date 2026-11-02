import { describe, expect, it } from 'vitest';
import { flashShelfGuardScript } from './flash-boot-script';

/** Chạy đoạn script như trình duyệt: `document.currentScript` là thẻ script, phần tử cha là `target`. */
function run(code: string, opts: { now: number }) {
  const target = { style: { display: 'initial' } as Record<string, string> };
  const script = { parentElement: target };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static override now() {
      return opts.now;
    }
  }
  new Function('document', 'Date', code)({ currentScript: script }, FakeDate);
  return target.style.display;
}

const T = Date.parse('2026-11-02T12:00:00Z');
const END = (min: number) => new Date(T + min * 60_000).toISOString();

describe('flashShelfGuardScript (kệ trong HTML ISR cũ)', () => {
  it('đủ suất còn giờ thì giữ kệ; dưới mức tối thiểu thì ẩn', () => {
    const ends = [END(5), END(10), END(-1)];
    expect(run(flashShelfGuardScript(ends, 2), { now: T })).toBe('initial');
    expect(run(flashShelfGuardScript(ends, 3), { now: T })).toBe('none');
    expect(run(flashShelfGuardScript(ends, 2), { now: T + 6 * 60_000 })).toBe('none');
  });
  it('đúng mốc endAt thì suất đã hết (giống `endAt > now` của khối)', () => {
    expect(run(flashShelfGuardScript([END(0), END(0), END(0)], 3), { now: T })).toBe('none');
  });
  it('chuỗi ngày hỏng không đếm là còn giờ', () => {
    expect(run(flashShelfGuardScript(['không phải ngày', END(5), END(5)], 3), { now: T })).toBe('none');
  });
  it('không để chuỗi thoát khỏi thẻ script', () => {
    expect(flashShelfGuardScript(['</script><b>'], 1)).not.toContain('</script>');
  });
});
