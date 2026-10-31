import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { FlashSaleController } from './flash-sale.controller';
import type { FlashSaleService } from './flash-sale.service';

const handler = (name: keyof FlashSaleController) => FlashSaleController.prototype[name] as unknown as object;
const isPublic = (name: keyof FlashSaleController) => Reflect.getMetadata(IS_PUBLIC_KEY, handler(name)) === true;

describe('FlashSaleController — /upcoming công khai (khách chưa đăng nhập xem được khung sắp tới)', () => {
  it('upcoming: @Public + OptionalJwtAuthGuard (có phiên thì biết khách, token hỏng/hết hạn thành khách chứ không 401) + private, no-store', () => {
    expect(isPublic('upcoming')).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler('upcoming'))).toContain(OptionalJwtAuthGuard);
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler('upcoming')) as { name: string; value: string }[];
    expect(headers.find((h) => h.name.toLowerCase() === 'cache-control')?.value).toBe('private, no-store');
  });

  it('nhắc / huỷ nhắc vẫn cần đăng nhập (không @Public)', () => {
    expect(isPublic('remind')).toBe(false);
    expect(isPublic('cancelRemind')).toBe(false);
  });

  it('upcoming chuyển userId (hoặc undefined khi khách) cho listUpcoming', async () => {
    const svc = { listUpcoming: jest.fn().mockResolvedValue([]) };
    const ctl = new FlashSaleController(svc as unknown as FlashSaleService);
    await ctl.upcoming('u1');
    await ctl.upcoming(undefined);
    expect(svc.listUpcoming.mock.calls).toEqual([['u1'], [undefined]]);
  });
});
