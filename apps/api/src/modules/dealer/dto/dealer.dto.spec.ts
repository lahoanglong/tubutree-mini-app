import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ApplyDealerDto } from './dealer.dto';

async function errorKeys(plain: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ApplyDealerDto, plain);
  const errs = await validate(dto, { whitelist: true });
  const walk = (e: import('class-validator').ValidationError[]): string[] =>
    e.flatMap((x) => [...Object.keys(x.constraints ?? {}), ...walk(x.children ?? [])]);
  return walk(errs);
}

const BASE = {
  businessName: 'Cửa hàng Xanh',
  ownerName: 'Nguyễn Văn A',
  phone: '0900000000',
  address: '123 Đường ABC, Quận 1, TP.HCM',
};

// Ảnh nén thật từ image-upload.tsx (readAndCompressImage, ~150-250KB JPEG) mã hoá base64 dài
// khoảng 200-330 nghìn ký tự — dùng chuỗi ngắn giả lập ở đây cho gọn test, chỉ chọn đúng "hình dạng"
// data URL thật (data:image/jpeg;base64,<base64>).
const SMALL_DATA_URL = `data:image/jpeg;base64,${'A'.repeat(1000)}`;

describe('ApplyDealerDto — A5-10 (docs/audit-2026-09): ảnh CCCD phải chấp nhận CẢ URL lẫn base64 data-URL', () => {
  it('hợp lệ với URL http(s) (không đổi hành vi cũ)', async () => {
    expect(
      await errorKeys({ ...BASE, cccdFrontUrl: 'https://cdn.example.com/a.jpg', cccdBackUrl: 'https://cdn.example.com/b.jpg' }),
    ).toHaveLength(0);
  });

  it('hợp lệ với base64 data-URL (fallback thật của image-upload.tsx khi thiếu Cloudinary env)', async () => {
    expect(
      await errorKeys({ ...BASE, cccdFrontUrl: SMALL_DATA_URL, cccdBackUrl: SMALL_DATA_URL }),
    ).toHaveLength(0);
  });

  it('chuỗi rác (không phải URL, không phải data-URL ảnh) → vẫn bị chặn', async () => {
    const keys = await errorKeys({ ...BASE, cccdFrontUrl: 'chuoi-rac-khong-hop-le', cccdBackUrl: 'https://cdn.example.com/b.jpg' });
    expect(keys.length).toBeGreaterThan(0);
  });

  it('data-URL không phải ảnh (vd application/pdf) → vẫn bị chặn', async () => {
    const keys = await errorKeys({
      ...BASE,
      cccdFrontUrl: `data:application/pdf;base64,${'A'.repeat(1000)}`,
      cccdBackUrl: 'https://cdn.example.com/b.jpg',
    });
    expect(keys.length).toBeGreaterThan(0);
  });

  it('base64 data-URL quá khổ (DoS) → bị chặn dù đúng định dạng ảnh', async () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(3_000_000)}`;
    const keys = await errorKeys({ ...BASE, cccdFrontUrl: huge, cccdBackUrl: 'https://cdn.example.com/b.jpg' });
    expect(keys.length).toBeGreaterThan(0);
  });

  it('storeFrontUrl (tuỳ chọn) cũng chấp nhận base64 data-URL', async () => {
    expect(
      await errorKeys({
        ...BASE,
        cccdFrontUrl: 'https://cdn.example.com/a.jpg',
        cccdBackUrl: 'https://cdn.example.com/b.jpg',
        storeFrontUrl: SMALL_DATA_URL,
      }),
    ).toHaveLength(0);
  });
});
