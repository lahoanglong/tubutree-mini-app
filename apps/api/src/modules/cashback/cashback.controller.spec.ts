import { UnauthorizedException } from '@nestjs/common';
import { CashbackController } from './cashback.controller';
import type { CashbackService } from './cashback.service';

const SECRET = 'at-secret-token';
const dto = { utm_content: 'click-1', order_id: 'O1', amount: 500000, commission: 50000, status: 'approved' as const };

function makeController(secret: string) {
  const handlePostback = jest.fn().mockResolvedValue({ ok: true });
  const cashback = { handlePostback } as unknown as CashbackService;
  const config = { get: () => secret } as never;
  return { ctrl: new CashbackController(cashback, config), handlePostback };
}

describe('CashbackController.postback (verify webhook secret)', () => {
  it('secret cấu hình + token đúng → xử lý postback', async () => {
    const { ctrl, handlePostback } = makeController(SECRET);
    await ctrl.postback(dto, SECRET);
    expect(handlePostback).toHaveBeenCalledWith(dto);
  });

  it('secret cấu hình + token SAI → 401, không xử lý (chống tự duyệt giả)', () => {
    const { ctrl, handlePostback } = makeController(SECRET);
    expect(() => ctrl.postback(dto, 'sai-token')).toThrow(UnauthorizedException);
    expect(handlePostback).not.toHaveBeenCalled();
  });

  it('secret cấu hình + thiếu token → 401', () => {
    const { ctrl, handlePostback } = makeController(SECRET);
    expect(() => ctrl.postback(dto, undefined)).toThrow(UnauthorizedException);
    expect(handlePostback).not.toHaveBeenCalled();
  });

  it('chưa cấu hình secret (dev) → bỏ qua verify, vẫn xử lý', async () => {
    const { ctrl, handlePostback } = makeController('');
    await ctrl.postback(dto, undefined);
    expect(handlePostback).toHaveBeenCalledWith(dto);
  });
});
