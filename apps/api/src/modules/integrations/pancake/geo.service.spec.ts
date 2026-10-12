import { BadRequestException } from '@nestjs/common';
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
