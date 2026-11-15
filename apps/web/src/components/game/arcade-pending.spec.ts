// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARCADE_PENDING_KEY, ARCADE_PENDING_TTL_MS, clearPendingArcade, rememberPendingArcade, takePendingArcade } from './arcade-pending';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
// Mã ván cấp lúc bấm Chơi, trước khi ván xong 40 giây: máy chủ hết hạn mã sau 10 phút kể từ lúc CẤP.
const RUN = { gameId: 'dew_catcher' as const, score: 520, durationMs: 40_000, runId: 'r1.dew_catcher.1700000000000.nonce.sig', expiresAt: NOW - 40_000 + 10 * MINUTE };
const raw = () => sessionStorage.getItem(ARCADE_PENDING_KEY);

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('arcade-pending (ván khách chờ qua vòng đăng nhập)', () => {
  it('ghi rồi lấy lại đủ sáu trường (kèm mã ván và giờ hết hạn của mã); lấy xong là xoá khoá, lấy lần hai không còn gì', () => {
    rememberPendingArcade(RUN, NOW);
    expect(JSON.parse(raw()!)).toEqual({ ...RUN, endedAt: NOW });
    expect(takePendingArcade(NOW + 5_000)).toEqual({ ...RUN, endedAt: NOW });
    expect(raw()).toBeNull();
    expect(takePendingArcade(NOW + 5_000)).toBeNull();
  });

  it('hết hạn theo giờ máy chủ cấp mã (expiresAt), không theo giờ ván xong: đúng mốc là bỏ và vẫn xoá khoá, sát trước mốc còn nhận', () => {
    rememberPendingArcade(RUN, NOW);
    expect(takePendingArcade(RUN.expiresAt - 1)).not.toBeNull();
    rememberPendingArcade(RUN, NOW);
    expect(takePendingArcade(RUN.expiresAt)).toBeNull();
    expect(raw()).toBeNull();
  });

  it('mã cấp từ lâu (ván dài, xin mã sớm): hết hạn sớm hơn 10 phút kể từ lúc ván xong thì vẫn bị bỏ', () => {
    // Ván xong lúc NOW nhưng mã đã cấp 4 phút trước đó nên hết hạn lúc NOW + 6 phút: tại NOW + 7 phút chỉ mới 7 phút sau ván, vẫn phải bỏ.
    rememberPendingArcade({ ...RUN, expiresAt: NOW + 6 * MINUTE }, NOW);
    expect(takePendingArcade(NOW + 7 * MINUTE)).toBeNull();
    rememberPendingArcade({ ...RUN, expiresAt: NOW + 6 * MINUTE }, NOW);
    expect(takePendingArcade(NOW + 5 * MINUTE)).not.toBeNull();
  });

  it('trần 10 phút kể từ lúc ván xong vẫn giữ: expiresAt xa hơn cũng không kéo dài hạn', () => {
    const far = { ...RUN, expiresAt: NOW + 60 * MINUTE };
    rememberPendingArcade(far, NOW);
    expect(takePendingArcade(NOW + ARCADE_PENDING_TTL_MS)).not.toBeNull();
    rememberPendingArcade(far, NOW);
    expect(takePendingArcade(NOW + ARCADE_PENDING_TTL_MS + 1)).toBeNull();
    expect(raw()).toBeNull();
  });

  it('mốc giờ ở tương lai xa (đồng hồ sai hoặc dữ liệu giả) bị bỏ; lệch nhẹ dưới một phút vẫn nhận', () => {
    rememberPendingArcade({ ...RUN, endedAt: NOW + 30_000 }, NOW);
    expect(takePendingArcade(NOW)).not.toBeNull();
    rememberPendingArcade({ ...RUN, endedAt: NOW + 5 * 60_000 }, NOW);
    expect(takePendingArcade(NOW)).toBeNull();
  });

  it.each([
    ['không phải JSON', 'abc'],
    ['null', 'null'],
    ['game lạ', JSON.stringify({ ...RUN, gameId: 'khac', score: 1, durationMs: 1000, endedAt: NOW })],
    ['thiếu mã ván (bản cũ)', JSON.stringify({ gameId: 'dew_catcher', score: 520, durationMs: 40_000, endedAt: NOW })],
    ['có mã ván nhưng thiếu giờ hết hạn (khoá cũ)', JSON.stringify({ gameId: 'dew_catcher', score: 520, durationMs: 40_000, runId: RUN.runId, endedAt: NOW })],
    ['giờ hết hạn là chữ', JSON.stringify({ ...RUN, expiresAt: '2026-11-15T10:10:00.000Z', endedAt: NOW })],
    ['giờ hết hạn null (NaN khi ghi)', JSON.stringify({ ...RUN, expiresAt: null, endedAt: NOW })],
    ['mã ván rỗng', JSON.stringify({ ...RUN, runId: '', endedAt: NOW })],
    ['mã ván không phải chữ', JSON.stringify({ ...RUN, runId: 7, endedAt: NOW })],
    ['mã ván dài quá 200 ký tự', JSON.stringify({ ...RUN, runId: 'x'.repeat(201), endedAt: NOW })],
    ['điểm âm', JSON.stringify({ ...RUN, score: -1, endedAt: NOW })],
    ['điểm lẻ', JSON.stringify({ ...RUN, score: 1.5, endedAt: NOW })],
    ['điểm là chữ', JSON.stringify({ ...RUN, score: '520', endedAt: NOW })],
    ['thời lượng 0', JSON.stringify({ ...RUN, durationMs: 0, endedAt: NOW })],
    ['thiếu mốc giờ', JSON.stringify(RUN)],
  ])('dữ liệu hỏng (%s): trả null và xoá khoá', (_name, value) => {
    sessionStorage.setItem(ARCADE_PENDING_KEY, value);
    expect(takePendingArcade(NOW)).toBeNull();
    expect(raw()).toBeNull();
  });

  it('chưa ghi gì thì lấy ra null', () => {
    expect(takePendingArcade(NOW)).toBeNull();
  });

  it('clearPendingArcade xoá khoá', () => {
    rememberPendingArcade(RUN, NOW);
    clearPendingArcade();
    expect(raw()).toBeNull();
  });

  it('ghi lại ván cũ giữ nguyên mốc giờ gốc (không kéo dài hạn 10 phút)', () => {
    rememberPendingArcade({ ...RUN, endedAt: NOW - 9 * 60_000 }, NOW);
    expect(JSON.parse(raw()!).endedAt).toBe(NOW - 9 * 60_000);
  });

  it('storage hỏng: ghi không ném lỗi, lấy ra null, xoá không ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('đầy');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('chặn');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('chặn');
    });
    expect(() => rememberPendingArcade(RUN, NOW)).not.toThrow();
    expect(takePendingArcade(NOW)).toBeNull();
    expect(() => clearPendingArcade()).not.toThrow();
  });
});
