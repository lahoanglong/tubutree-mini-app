import { ServiceUnavailableException } from '@nestjs/common';
import { PancakeController } from './pancake.controller';

describe('PancakeController.runSync — lỗi Pancake báo bằng tiếng Việt, không "Internal server error" (R2-ADMINOPS-8)', () => {
  const make = (err: unknown) =>
    new PancakeController({ syncProducts: jest.fn().mockRejectedValue(err) } as never, {} as never);

  it('Pancake trả 500 (lỗi axios) → 503 kèm lý do', async () => {
    const res = make(Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true })).runSync();
    await expect(res).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(res).rejects.toThrow(/Không đồng bộ được danh mục Pancake.*status code 500/);
  });

  it('lỗi đã là HttpException (đang có lượt đồng bộ khác) → giữ nguyên', async () => {
    const original = new ServiceUnavailableException('Đang có lượt đồng bộ khác chạy.');
    await expect(make(original).runSync()).rejects.toBe(original);
  });
});
