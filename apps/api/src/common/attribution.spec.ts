import { firstTouchColumns, normalizeEntryToken, sanitizeFirstTouch } from './attribution';

describe('normalizeEntryToken', () => {
  it.each([
    ['shopee', 'shopee'],
    ['  Shopee ', 'shopee'],
    ['card-2610', 'card-2610'],
    ['utm_tiktok-live', 'utm_tiktok-live'],
    ['a', 'a'],
    ['x'.repeat(40), 'x'.repeat(40)],
  ])('%j → %j', (raw, out) => {
    expect(normalizeEntryToken(raw)).toBe(out);
  });

  it.each([
    [''],
    ['   '],
    ['-shopee'],
    ['_shopee'],
    ['x'.repeat(41)],
    ['shopee/../x'],
    ['shopee;drop table'],
    ['<script>'],
    ['sàn'],
    ['a b'],
    [42],
    [null],
    [undefined],
    [{}],
    [['shopee']],
  ])('giá trị bẩn %j → null', (raw) => {
    expect(normalizeEntryToken(raw)).toBeNull();
  });
});

describe('sanitizeFirstTouch', () => {
  const now = new Date('2026-10-18T05:00:00.000Z');

  it('nguồn + chiến dịch hợp lệ → giữ nguyên, chuẩn hoá chữ thường', () => {
    expect(sanitizeFirstTouch({ source: 'Shopee', campaign: 'Hop-Hang_2610' }, now)).toEqual({
      source: 'shopee',
      campaign: 'hop-hang_2610',
      at: now,
    });
  });

  it('không có chiến dịch → campaign null', () => {
    expect(sanitizeFirstTouch({ source: 'oa' }, now)).toEqual({ source: 'oa', campaign: null, at: now });
  });

  it('chiến dịch bẩn → bỏ riêng chiến dịch, vẫn giữ nguồn', () => {
    expect(sanitizeFirstTouch({ source: 'lazada', campaign: 'a b!' }, now)).toEqual({
      source: 'lazada',
      campaign: null,
      at: now,
    });
  });

  it.each([
    ['nguồn bẩn', { source: 'x y' }],
    ['nguồn quá dài', { source: 'x'.repeat(41) }],
    ['thiếu nguồn', { campaign: 'abc' }],
    ['nguồn không phải chuỗi', { source: 7 }],
    ['chuỗi trần', 'shopee'],
    ['mảng', ['shopee']],
    ['null', null],
    ['undefined', undefined],
    ['số', 5],
  ])('%s → null (bỏ cả lần chạm)', (_label, raw) => {
    expect(sanitizeFirstTouch(raw, now)).toBeNull();
  });

  describe('thời điểm chạm do client khai (at)', () => {
    it('hợp lệ trong 90 ngày gần nhất → dùng', () => {
      const at = '2026-10-10T01:02:03.000Z';
      expect(sanitizeFirstTouch({ source: 'tiktok', at }, now)?.at).toEqual(new Date(at));
    });

    it.each([
      ['không phải ngày', 'hôm qua'],
      ['tương lai xa', '2026-10-20T00:00:00.000Z'],
      ['cũ hơn 90 ngày', '2026-06-01T00:00:00.000Z'],
      ['số', 1_760_000_000_000],
    ])('%s → dùng giờ máy chủ', (_label, at) => {
      expect(sanitizeFirstTouch({ source: 'tiktok', at }, now)?.at).toEqual(now);
    });

    it('lệch đồng hồ vài phút về tương lai vẫn nhận', () => {
      const at = '2026-10-18T05:03:00.000Z';
      expect(sanitizeFirstTouch({ source: 'tiktok', at }, now)?.at).toEqual(new Date(at));
    });
  });
});

describe('firstTouchColumns', () => {
  const now = new Date('2026-10-18T05:00:00.000Z');

  it('chạm hợp lệ → ba cột của User', () => {
    expect(firstTouchColumns({ source: 'fb', campaign: 'livestream' }, now)).toEqual({
      firstTouchSource: 'fb',
      firstTouchCampaign: 'livestream',
      firstTouchAt: now,
    });
  });

  it('bẩn hoặc vắng → {} (không ghi gì, không làm hỏng lệnh tạo user)', () => {
    expect(firstTouchColumns({ source: '??' }, now)).toEqual({});
    expect(firstTouchColumns(undefined, now)).toEqual({});
  });
});
