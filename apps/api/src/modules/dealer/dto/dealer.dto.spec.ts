import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ApplyDealerDto } from './dealer.dto';
import { createValidationPipe } from '../../../common/validation-pipe';

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
const SMALL_DATA_URL = `data:image/jpeg;base64,/9j/${'A'.repeat(1000)}`;
const HOSTED = 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg';

describe('ApplyDealerDto — A5-10 (docs/audit-2026-09): ảnh CCCD chấp nhận CẢ URL host upload lẫn base64 data-URL', () => {
  it('hợp lệ với URL https của host upload (Cloudinary)', async () => {
    expect(
      await errorKeys({ ...BASE, cccdFrontUrl: HOSTED, cccdBackUrl: HOSTED }),
    ).toHaveLength(0);
  });

  it('hợp lệ với base64 data-URL (fallback thật của image-upload.tsx khi thiếu Cloudinary env)', async () => {
    expect(
      await errorKeys({ ...BASE, cccdFrontUrl: SMALL_DATA_URL, cccdBackUrl: SMALL_DATA_URL }),
    ).toHaveLength(0);
  });

  it('chuỗi rác (không phải URL, không phải data-URL ảnh) → vẫn bị chặn', async () => {
    const keys = await errorKeys({ ...BASE, cccdFrontUrl: 'chuoi-rac-khong-hop-le', cccdBackUrl: HOSTED });
    expect(keys.length).toBeGreaterThan(0);
  });

  it('data-URL không phải ảnh (vd application/pdf) → vẫn bị chặn', async () => {
    const keys = await errorKeys({
      ...BASE,
      cccdFrontUrl: `data:application/pdf;base64,${'A'.repeat(1000)}`,
      cccdBackUrl: HOSTED,
    });
    expect(keys.length).toBeGreaterThan(0);
  });

  it('base64 data-URL quá khổ (DoS) → bị chặn dù đúng định dạng ảnh', async () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(3_000_000)}`;
    const keys = await errorKeys({ ...BASE, cccdFrontUrl: huge, cccdBackUrl: HOSTED });
    expect(keys.length).toBeGreaterThan(0);
  });

  it('storeFrontUrl (tuỳ chọn) cũng chấp nhận base64 data-URL', async () => {
    expect(
      await errorKeys({
        ...BASE,
        cccdFrontUrl: HOSTED,
        cccdBackUrl: HOSTED,
        storeFrontUrl: SMALL_DATA_URL,
      }),
    ).toHaveLength(0);
  });
});

const CLOUD = HOSTED;
const JPEG = SMALL_DATA_URL;
const base = { ...BASE, phone: '0912345678', cccdFrontUrl: CLOUD, cccdBackUrl: JPEG };
const keys = errorKeys;

describe('ApplyDealerDto — V1/V5 (SEC-1104): trần chữ, SĐT, MST, số, ảnh tải lên', () => {
  it('hồ sơ hợp lệ (ảnh Cloudinary + base64 JPEG đúng chữ ký) → không lỗi', async () => {
    expect(await keys({ ...base, taxCode: '0312345678', storeFrontUrl: CLOUD, monthlyVolumeEstimate: 5_000_000, notes: 'ok' })).toEqual([]);
  });
  it.each([
    ['businessName', 'x'.repeat(121), 'maxLength'],
    ['ownerName', 'x'.repeat(121), 'maxLength'],
    ['address', 'x'.repeat(501), 'maxLength'],
    ['notes', 'x'.repeat(1001), 'maxLength'],
  ])('%s quá dài → lỗi', async (field, value, rule) => {
    expect(await keys({ ...base, [field]: value })).toContain(rule);
  });
  it('mã số thuế sai dạng → lỗi; đúng dạng → hợp lệ', async () => {
    expect(await keys({ ...base, taxCode: 'abc' })).toContain('matches');
    expect(await keys({ ...base, taxCode: '0312345678-001' })).toEqual([]);
  });
  it('SĐT không phải số VN → lỗi', async () => {
    expect(await keys({ ...base, phone: '12345' })).toContain('isVnBusinessPhone');
  });
  it.each([3_000_000_000, -1, 1.5])('monthlyVolumeEstimate %p → lỗi', async (n) => {
    expect((await keys({ ...base, monthlyVolumeEstimate: n })).length).toBeGreaterThan(0);
  });
  it.each([
    ['base64 sai chữ ký', `data:image/jpeg;base64,${'A'.repeat(1000)}`],
    ['http://', 'http://x'],
    ['host lạ', 'https://evil.example/a.jpg'],
    ['SVG', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['quá trần 1,5 triệu ký tự', `data:image/jpeg;base64,/9j/${'A'.repeat(1_500_001)}`],
  ])('ảnh CCCD: %s → lỗi', async (_l, v) => {
    expect(await keys({ ...base, cccdFrontUrl: v })).toContain('isUploadedImage');
    expect(await keys({ ...base, cccdBackUrl: v })).toContain('isUploadedImage');
    expect(await keys({ ...base, storeFrontUrl: v })).toContain('isUploadedImage');
  });
});

describe('ApplyDealerDto — sửa sau review (M1, M2, SĐT bàn)', () => {
  const pipe = createValidationPipe();
  const run = (body: Record<string, unknown>) =>
    pipe.transform({ ...base, ...body }, { type: 'body', metatype: ApplyDealerDto }) as Promise<ApplyDealerDto>;

  it.each([[''], ['   ']])('taxCode %j (khách gõ rồi xoá) → được nhận, lưu như không gửi', async (v) => {
    const dto = await run({ taxCode: v });
    expect(dto.taxCode).toBeUndefined();
  });
  it('taxCode có khoảng trắng hai đầu → cắt rồi kiểm', async () => {
    expect((await run({ taxCode: ' 0312345678 ' })).taxCode).toBe('0312345678');
    await expect(run({ taxCode: 'abc' })).rejects.toThrow();
  });
  it.each([[''], ['  ']])('storeFrontUrl %j → được nhận, bỏ qua', async (v) => {
    expect((await run({ storeFrontUrl: v })).storeFrontUrl).toBeUndefined();
  });

  it('ảnh đúng trần nén của web (1.400.000 ký tự) → hợp lệ; ảnh sai/quá trần → câu lỗi tiếng Việt không lộ tên trường', async () => {
    const big = `data:image/jpeg;base64,/9j/${'A'.repeat(1_400_000 - 'data:image/jpeg;base64,/9j/'.length)}`;
    expect(big.length).toBe(1_400_000);
    expect(await keys({ ...base, cccdFrontUrl: big })).toEqual([]);
    const errs = await validate(plainToInstance(ApplyDealerDto, { ...base, cccdFrontUrl: `data:image/jpeg;base64,/9j/${'A'.repeat(1_500_001)}` }));
    const msg = Object.values(errs[0]!.constraints!)[0]!;
    expect(msg).toBe('Ảnh quá nặng hoặc không hợp lệ, vui lòng chụp lại hoặc chọn ảnh nhỏ hơn.');
    expect(msg).not.toContain('cccdFrontUrl');
  });

  it.each([
    ['0912345678', '0912345678'],
    ['02838234567', '02838234567'],
    ['028 3823 4567', '02838234567'],
    ['028.3823.4567', '02838234567'],
    ['(028) 3823-4567', '02838234567'],
    ['+84 912 345 678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['842838234567', '02838234567'],
  ])('SĐT %s → hợp lệ, lưu dạng %s', async (phone, stored) => {
    expect(await keys({ ...base, phone })).toEqual([]);
    expect((await run({ phone })).phone).toBe(stored);
  });
  it.each([['12345'], ['abc'], ['091234567'], ['09123456789'], ['+840912345678'], ['0212345678'], ['0212345678901'], ['1912345678'], ['0912a45678'], ['0112345678']])('SĐT %s → lỗi', async (phone) => {
    expect((await keys({ ...base, phone })).length).toBeGreaterThan(0);
  });
});
