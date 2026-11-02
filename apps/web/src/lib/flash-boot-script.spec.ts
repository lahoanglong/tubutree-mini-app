import { describe, expect, it } from 'vitest';
import { FLASH_EXPECT_WINDOW_MS, FLASH_HINT_KEY, readFlashExpected } from '@tubutree/app-core/home-layout';
import { flashReserveScript, flashShelfGuardScript } from './flash-boot-script';

/** Chạy đoạn script như trình duyệt: `document.currentScript` là thẻ script, phần tử liền trước là `target`. */
function run(code: string, opts: { now: number; stored?: string | null; throwStorage?: boolean }) {
  const target = { style: { display: 'initial' } as Record<string, string> };
  const script = { previousElementSibling: target };
  const RealDate = Date;
  class FakeDate extends RealDate {
    static override now() {
      return opts.now;
    }
  }
  const storage = {
    getItem: (k: string) => {
      if (opts.throwStorage) throw new Error('blocked');
      return k === FLASH_HINT_KEY ? (opts.stored ?? null) : null;
    },
  };
  new Function('document', 'Date', 'localStorage', code)({ currentScript: script }, FakeDate, storage);
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

describe('flashReserveScript (HTML dựng chưa có suất)', () => {
  const reserve = flashReserveScript();
  it('hiện khung giữ chỗ khi giờ mở dự kiến đã tới và chưa quá cửa sổ, cùng kết luận với readFlashExpected', () => {
    for (const [now, stored] of [
      [T - 1, `0@${T}`], [T, `0@${T}`], [T + FLASH_EXPECT_WINDOW_MS - 1, `0@${T}`], [T + FLASH_EXPECT_WINDOW_MS, `0@${T}`],
      [T, '1'], [T, '2'], [T, '0'], [T, null], [T, '0@abc'], [T, '0@'],
    ] as const) {
      const shown = run(reserve, { now, stored }) === 'block';
      expect(shown, `${stored} @${now - T}`).toBe(readFlashExpected({ getItem: () => stored, setItem: () => undefined }, now));
    }
  });
  it('kho bị chặn thì không văng và không giữ chỗ', () => {
    expect(run(reserve, { now: T, throwStorage: true })).toBe('initial');
  });
});
