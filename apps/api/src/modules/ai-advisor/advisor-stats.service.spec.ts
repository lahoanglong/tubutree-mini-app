import { AdvisorStatsService, type AdvisorStatsEvent } from './advisor-stats.service';

const ev = (over: Partial<AdvisorStatsEvent> = {}): AdvisorStatsEvent => ({ outcome: 'ok', ms: 100, products: [], ...over });
const sku = (n: number) => ({ slug: `sku-${n}`, name: `Sản phẩm ${n}` });

describe('AdvisorStatsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('chưa có lượt nào: số 0, p95 null, không có sản phẩm, `since` là lúc khởi tạo', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 12, 8, 0, 0));
    const s = new AdvisorStatsService();
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 12, 9, 0, 0));
    expect(s.snapshot()).toEqual({ since: '2026-11-12T08:00:00.000Z', total: 0, ok: 0, fallback: 0, latencyP95Ms: null, latencySamples: 0, topSkus: [] });
  });

  it('đếm ok và fallback, total là tổng hai loại', () => {
    const s = new AdvisorStatsService();
    s.record(ev({ outcome: 'ok' }));
    s.record(ev({ outcome: 'ok' }));
    s.record(ev({ outcome: 'fallback' }));
    expect(s.snapshot()).toMatchObject({ total: 3, ok: 2, fallback: 1 });
  });

  describe('p95 phương pháp nearest-rank', () => {
    it('một mẫu: chính nó', () => {
      const s = new AdvisorStatsService();
      s.record(ev({ ms: 420 }));
      expect(s.snapshot().latencyP95Ms).toBe(420);
    });

    it('100 mẫu 1..100: p95 = phần tử thứ ceil(0.95·100) = 95', () => {
      const s = new AdvisorStatsService();
      for (let ms = 100; ms >= 1; ms--) s.record(ev({ ms }));
      const snap = s.snapshot();
      expect(snap.latencyP95Ms).toBe(95);
      expect(snap.latencySamples).toBe(100);
    });

    it('20 mẫu: p95 = phần tử thứ 19 (không nội suy, không phải mẫu lớn nhất)', () => {
      const s = new AdvisorStatsService();
      for (let ms = 1; ms <= 20; ms++) s.record(ev({ ms: ms * 10 }));
      expect(s.snapshot().latencyP95Ms).toBe(190);
    });

    it('10 mẫu: ceil(9,5) = 10 nên p95 là mẫu lớn nhất', () => {
      const s = new AdvisorStatsService();
      for (let ms = 1; ms <= 10; ms++) s.record(ev({ ms }));
      expect(s.snapshot().latencyP95Ms).toBe(10);
    });

    it('không phụ thuộc thứ tự ghi', () => {
      const s = new AdvisorStatsService();
      for (const ms of [900, 5, 300, 50, 700, 20, 1000, 10, 600, 40]) s.record(ev({ ms }));
      expect(s.snapshot().latencyP95Ms).toBe(1000);
    });

    it('mẫu hỏng (NaN, âm, vô cực) không vào vòng đệm nhưng lượt vẫn được đếm', () => {
      const s = new AdvisorStatsService();
      for (const ms of [Number.NaN, -5, Number.POSITIVE_INFINITY]) s.record(ev({ ms }));
      const snap = s.snapshot();
      expect(snap.total).toBe(3);
      expect(snap.latencySamples).toBe(0);
      expect(snap.latencyP95Ms).toBeNull();
    });
  });

  describe('vòng đệm 500 mẫu độ trễ', () => {
    it('tràn thì ghi đè mẫu cũ nhất: chỉ còn 500 mẫu gần nhất', () => {
      const s = new AdvisorStatsService();
      // 500 mẫu rất chậm rồi 500 mẫu nhanh: các mẫu chậm phải bị ghi đè hết.
      for (let i = 0; i < 500; i++) s.record(ev({ ms: 9_000 }));
      expect(s.snapshot().latencyP95Ms).toBe(9_000);
      for (let i = 0; i < 500; i++) s.record(ev({ ms: 100 }));
      const snap = s.snapshot();
      expect(snap.latencySamples).toBe(500);
      expect(snap.latencyP95Ms).toBe(100);
      expect(snap.total).toBe(1000);
    });

    it('tràn từng phần: 600 mẫu thì mẫu 0..99 bị thay bằng 500..599', () => {
      const s = new AdvisorStatsService();
      for (let i = 0; i < 600; i++) s.record(ev({ ms: i }));
      const snap = s.snapshot();
      expect(snap.latencySamples).toBe(500);
      // Còn lại 100..599: nearest-rank thứ ceil(0,95·500)=475 → 100 + 474 = 574.
      expect(snap.latencyP95Ms).toBe(574);
    });
  });

  describe('sản phẩm gợi ý nhiều nhất', () => {
    it('top 5 giảm dần theo số lần gợi ý, kèm slug và tên', () => {
      const s = new AdvisorStatsService();
      for (let n = 1; n <= 7; n++) for (let k = 0; k < n; k++) s.record(ev({ products: [sku(n)] }));
      expect(s.snapshot().topSkus).toEqual([
        { slug: 'sku-7', name: 'Sản phẩm 7', count: 7 },
        { slug: 'sku-6', name: 'Sản phẩm 6', count: 6 },
        { slug: 'sku-5', name: 'Sản phẩm 5', count: 5 },
        { slug: 'sku-4', name: 'Sản phẩm 4', count: 4 },
        { slug: 'sku-3', name: 'Sản phẩm 3', count: 3 },
      ]);
    });

    it('hoà số đếm thì xếp theo tên tăng dần (không phụ thuộc thứ tự ghi)', () => {
      const s = new AdvisorStatsService();
      s.record(ev({ products: [{ slug: 'c', name: 'Cà phê' }, { slug: 'a', name: 'An' }, { slug: 'b', name: 'Bột' }] }));
      expect(s.snapshot().topSkus.map((t) => t.name)).toEqual(['An', 'Bột', 'Cà phê']);
    });

    it('một lượt gợi ý trùng slug chỉ tính một lần', () => {
      const s = new AdvisorStatsService();
      s.record(ev({ products: [sku(1), sku(1), sku(2)] }));
      expect(s.snapshot().topSkus).toEqual([
        { slug: 'sku-1', name: 'Sản phẩm 1', count: 1 },
        { slug: 'sku-2', name: 'Sản phẩm 2', count: 1 },
      ]);
    });

    it('lượt fallback vẫn tính sản phẩm đã gợi ý (khách vẫn thấy thẻ gợi ý)', () => {
      const s = new AdvisorStatsService();
      s.record(ev({ outcome: 'fallback', products: [sku(1)] }));
      expect(s.snapshot().topSkus).toEqual([{ slug: 'sku-1', name: 'Sản phẩm 1', count: 1 }]);
    });

    it('đầy 500 khoá thì loại khoá đếm thấp nhất để nhường chỗ, khoá đếm cao còn nguyên', () => {
      const s = new AdvisorStatsService();
      // sku-0 được gợi ý 5 lần, 499 khoá còn lại 1 lần: bảng đầy 500.
      for (let k = 0; k < 5; k++) s.record(ev({ products: [sku(0)] }));
      for (let n = 1; n < 500; n++) s.record(ev({ products: [sku(n)] }));
      // Khoá mới vào: khoá đếm thấp nhất (và vào sớm nhất trong số đó) là sku-1 bị loại.
      s.record(ev({ products: [sku(9999)] }));
      s.record(ev({ products: [sku(1)] })); // sku-1 quay lại như khoá mới: đếm từ 1, chứng tỏ bản cũ đã bị loại
      const top = s.snapshot().topSkus;
      expect(top[0]).toEqual({ slug: 'sku-0', name: 'Sản phẩm 0', count: 5 });
      expect(top.find((t) => t.slug === 'sku-1')).toMatchObject({ count: 1 });
      expect(top).toHaveLength(5);
    });

    it('bảng không bao giờ vượt 500 khoá dù có hàng nghìn sản phẩm khác nhau', () => {
      const s = new AdvisorStatsService();
      for (let n = 0; n < 2_000; n++) s.record(ev({ products: [sku(n)] }));
      // Đọc qua trạng thái nội bộ: không có API công khai nào trả cả bảng.
      expect((s as unknown as { skus: Map<string, unknown> }).skus.size).toBe(500);
    });

    it('khoá đã có thì cộng dồn và cập nhật tên mới nhất, không bị loại khi bảng đầy', () => {
      const s = new AdvisorStatsService();
      for (let n = 0; n < 500; n++) s.record(ev({ products: [sku(n)] }));
      s.record(ev({ products: [{ slug: 'sku-10', name: 'Tên mới' }] }));
      expect(s.snapshot().topSkus[0]).toEqual({ slug: 'sku-10', name: 'Tên mới', count: 2 });
    });
  });

  it('không lưu chữ nào của khách: snapshot chỉ gồm số đếm, thời gian, slug và tên sản phẩm', () => {
    const s = new AdvisorStatsService();
    s.record(ev({ products: [sku(1)] }));
    expect(Object.keys(s.snapshot()).sort()).toEqual(['fallback', 'latencyP95Ms', 'latencySamples', 'ok', 'since', 'topSkus', 'total']);
  });
});
