import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GeoService } from './geo.service';
import type { PancakeClient } from './pancake.client';

function makeService() {
  const pancake = {
    fetchProvinces: jest.fn().mockResolvedValue([
      { new_id: '84_VN26', name: 'Lâm Đồng' },
      { new_id: '84_VN01', name: 'Hà Nội' },
      { name: 'Tỉnh thiếu new_id' },
    ]),
    fetchCommunes: jest.fn().mockResolvedValue([
      { id: 'c2', name: 'Xã B' },
      { id: 'c1', name: 'Xã A' },
    ]),
  };
  return { svc: new GeoService(pancake as unknown as PancakeClient), pancake };
}

describe('GeoService.communes', () => {
  it('mã tỉnh có trong danh sách tỉnh → trả phường/xã đã sắp theo tên', async () => {
    const { svc, pancake } = makeService();
    await expect(svc.communes('84_VN26')).resolves.toEqual([
      { code: 'c1', name: 'Xã A' },
      { code: 'c2', name: 'Xã B' },
    ]);
    expect(pancake.fetchCommunes).toHaveBeenCalledWith('84_VN26');
  });

  // Không chặn mã lạ thì mỗi giá trị provinceCode tuỳ ý (endpoint công khai) thành một lượt gọi Pancake và một ô cache
  // giữ 24 giờ, nên bộ nhớ và hạn mức Pancake phụ thuộc vào kẻ gọi.
  it('mã tỉnh lạ → 400, không gọi Pancake, không thêm ô cache', async () => {
    const { svc, pancake } = makeService();
    await expect(svc.communes('x'.repeat(5000))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.communes('84_VN99')).rejects.toBeInstanceOf(BadRequestException);
    expect(pancake.fetchCommunes).not.toHaveBeenCalled();
    expect((svc as unknown as { communesCache: Map<string, unknown> }).communesCache.size).toBe(0);
  });

  it('tỉnh thiếu new_id không phải mã hợp lệ', async () => {
    const { svc } = makeService();
    await expect(svc.communes('undefined')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gọi lần hai cùng mã dùng cache, không gọi lại Pancake', async () => {
    const { svc, pancake } = makeService();
    await svc.communes('84_VN01');
    await svc.communes('84_VN01');
    expect(pancake.fetchCommunes).toHaveBeenCalledTimes(1);
    expect(pancake.fetchProvinces).toHaveBeenCalledTimes(1);
  });
});

describe('GeoService — Pancake trả rỗng / lỗi không được làm hỏng form địa chỉ cả ngày', () => {
  function svcWith(fetchProvinces: jest.Mock, fetchCommunes: jest.Mock = jest.fn()) {
    return new GeoService({ fetchProvinces, fetchCommunes } as unknown as PancakeClient);
  }

  it('danh sách tỉnh rỗng → 503 (FE hiện "Thử lại"), KHÔNG cache: lần sau Pancake ổn lại thì có dữ liệu', async () => {
    const fetchProvinces = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ new_id: '84_VN01', name: 'Hà Nội' }]);
    const svc = svcWith(fetchProvinces);
    await expect(svc.provinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.provinces()).resolves.toEqual([{ code: '84_VN01', name: 'Hà Nội' }]);
    expect(fetchProvinces).toHaveBeenCalledTimes(2);
  });

  it('danh sách rỗng khiến communes không báo nhầm "provinceCode không hợp lệ" (400) mà báo tạm lỗi (503)', async () => {
    const svc = svcWith(jest.fn().mockResolvedValue([]));
    await expect(svc.communes('84_VN01')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('cache tỉnh hết hạn + lần gọi mới lỗi/rỗng → giữ bản tốt gần nhất', async () => {
    const fetchProvinces = jest
      .fn()
      .mockResolvedValueOnce([{ new_id: '84_VN01', name: 'Hà Nội' }])
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([]);
    const svc = svcWith(fetchProvinces);
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      await svc.provinces();
      now.mockReturnValue(1_000 + 25 * 60 * 60 * 1000);
      await expect(svc.provinces()).resolves.toEqual([{ code: '84_VN01', name: 'Hà Nội' }]);
      await expect(svc.provinces()).resolves.toEqual([{ code: '84_VN01', name: 'Hà Nội' }]);
      expect(fetchProvinces).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it('phường/xã rỗng một lần → 503, không cache; lần sau có dữ liệu', async () => {
    const fetchCommunes = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '84_VN0100166', name: 'Phường Cầu Giấy' }]);
    const svc = svcWith(jest.fn().mockResolvedValue([{ new_id: '84_VN01', name: 'Hà Nội' }]), fetchCommunes);
    await expect(svc.communes('84_VN01')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.communes('84_VN01')).resolves.toEqual([{ code: '84_VN0100166', name: 'Phường Cầu Giấy' }]);
  });

  it('Pancake lỗi khi chưa từng có cache → 503 thay vì lỗi 500 thô', async () => {
    const svc = svcWith(jest.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(svc.provinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
