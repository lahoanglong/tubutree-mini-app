import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MarkPaidDto, UpdateBankDto } from './payroll.dto';
import { CancelShiftDto } from '../shifts/dto/shift.dto';

const CLOUD = 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg';
const JPEG = `data:image/jpeg;base64,/9j/${'A'.repeat(500)}`;
const BAD = [
  ['http://', 'http://res.cloudinary.com/a.jpg'],
  ['host lạ', 'https://evil.example/a.jpg'],
  ['javascript:', 'javascript:alert(1)'],
  ['SVG', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
  ['base64 sai chữ ký', `data:image/jpeg;base64,${'A'.repeat(500)}`],
] as const;

async function props(cls: new () => object, plain: Record<string, unknown>) {
  return (await validate(plainToInstance(cls, plain), { whitelist: true })).map((e) => e.property);
}

describe('ảnh lương/ca làm chỉ nhận ảnh đã tải lên (SEC-V7)', () => {
  it('QR lương, ảnh xác nhận, minh chứng huỷ ca: Cloudinary và base64 đúng chữ ký → hợp lệ', async () => {
    expect(await props(UpdateBankDto, { qrImageUrl: CLOUD })).toEqual([]);
    expect(await props(UpdateBankDto, { qrImageUrl: JPEG })).toEqual([]);
    expect(await props(MarkPaidDto, { year: 2026, month: 10, proofImageUrl: CLOUD })).toEqual([]);
    expect(await props(CancelShiftDto, { reason: 'ốm', evidenceUrl: JPEG })).toEqual([]);
  });
  it.each(BAD)('%s → lỗi ở cả ba trường', async (_l, v) => {
    expect(await props(UpdateBankDto, { qrImageUrl: v })).toContain('qrImageUrl');
    expect(await props(MarkPaidDto, { year: 2026, month: 10, proofImageUrl: v })).toContain('proofImageUrl');
    expect(await props(CancelShiftDto, { reason: 'ốm', evidenceUrl: v })).toContain('evidenceUrl');
  });
});
