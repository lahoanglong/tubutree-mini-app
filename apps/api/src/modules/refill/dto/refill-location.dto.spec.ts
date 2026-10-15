import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../common/validation-pipe';
import { CreateRefillLocationDto, ReorderRefillLocationsDto, UpdateRefillLocationDto } from './refill-location.dto';

const pipe = createValidationPipe();
async function run(metatype: new () => object, value: Record<string, unknown>) {
  return pipe.transform(value, { type: 'body', metatype, data: undefined });
}
async function messagesOf(metatype: new () => object, value: Record<string, unknown>): Promise<string[]> {
  try {
    await run(metatype, value);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { message: string[] }).message;
  }
  throw new Error('không ném lỗi');
}

describe('CreateRefillLocationDto', () => {
  it('tên và địa chỉ bắt buộc, toàn khoảng trắng bị coi là trống', async () => {
    expect(await messagesOf(CreateRefillLocationDto, { name: '   ', address: '' })).toEqual([
      'Tên điểm nhận không được để trống.',
      'Địa chỉ điểm nhận không được để trống.',
    ]);
    expect(await messagesOf(CreateRefillLocationDto, {})).toEqual(
      expect.arrayContaining(['Tên điểm nhận không được để trống.', 'Địa chỉ điểm nhận không được để trống.']),
    );
  });

  it('cắt khoảng trắng hai đầu; giờ và SĐT không bắt buộc', async () => {
    await expect(run(CreateRefillLocationDto, { name: '  Cửa hàng Q1 ', address: ' 12 Lê Lợi ' })).resolves.toMatchObject({
      name: 'Cửa hàng Q1',
      address: '12 Lê Lợi',
    });
  });

  const PHONE_MESSAGE =
    'SĐT điểm nhận phải để trống hoặc là di động (10 số bắt đầu bằng 0 hoặc +84), số bàn (02…, 10–11 số) hoặc tổng đài 1800/1900 (viết liền, không dấu cách).';

  describe('SĐT từng loại', () => {
    it.each([
      ['di động 0', '0901234567'],
      ['di động +84', '+84901234567'],
      ['số bàn 11 số (mã vùng 3 số)', '02543812345'],
      ['số bàn 11 số (Hà Nội 024)', '02438251234'],
      ['số bàn 11 số (TP.HCM 028)', '02838221234'],
      ['số bàn 10 số (02 + 8 số)', '0243825123'],
      ['số bàn +84 11 số', '+842838221234'],
      ['số bàn +84 10 số', '+84243825123'],
      ['tổng đài 1800 + 4 số', '18001234'],
      ['tổng đài 1800 + 6 số', '1800123456'],
      ['tổng đài 1900 + 4 số', '19001234'],
      ['tổng đài 1900 + 5 số', '190012345'],
      ['tổng đài 1900 + 6 số', '1900123456'],
      ['rỗng = không có số', ''],
    ])('%s (%s) hợp lệ và lưu nguyên chuỗi', async (_label, phone) => {
      await expect(run(CreateRefillLocationDto, { name: 'A', address: 'B', phone })).resolves.toMatchObject({ phone });
      await expect(run(UpdateRefillLocationDto, { phone })).resolves.toMatchObject({ phone });
    });

    it.each([
      ['thiếu một số di động', '090123456'],
      ['thừa một số di động', '09012345678'],
      ['+84 di động thiếu số', '+8490123456'],
      ['số bàn 12 số', '028382212345'],
      ['số bàn +84 11 số', '+8428382212345'],
      ['11 số bắt đầu 0 nhưng không phải mã vùng 2xx', '09012345678'],
      ['84 không có dấu +', '84901234567'],
      ['có dấu cách', '0901 234 567'],
      ['có dấu chấm', '028.3822.1234'],
      ['có dấu gạch và ngoặc', '(028)3822-1234'],
      ['+84 kèm 0 đầu (số bàn)', '+8402838221234'],
      ['chữ', 'abc'],
      ['1800 chỉ 3 số sau', '1800123'],
      ['1800 tới 7 số sau', '18001234567'],
      ['1900 chỉ 3 số sau', '1900123'],
      ['1900 tới 7 số sau', '19001234567'],
      ['đầu số 1700 không phải tổng đài', '17001234'],
      ['đầu số 1801', '18011234'],
      ['tổng đài dạng +84', '+8418001234'],
      ['tổng đài kèm 0', '018001234'],
      ['chỉ dấu +', '+'],
    ])('%s (%s) → 400', async (_label, phone) => {
      expect(await messagesOf(CreateRefillLocationDto, { name: 'A', address: 'B', phone })).toEqual([PHONE_MESSAGE]);
      expect(await messagesOf(UpdateRefillLocationDto, { phone })).toEqual([PHONE_MESSAGE]);
    });

    it('cắt khoảng trắng hai đầu rồi mới kiểm; chuỗi lưu đúng bằng chuỗi callPhone đưa vào tel:', async () => {
      const dto = await run(CreateRefillLocationDto, { name: 'A', address: 'B', phone: '  02838221234 ' });
      expect(dto).toMatchObject({ phone: '02838221234' });
      for (const phone of ['0901234567', '+84901234567', '02838221234', '+842838221234', '19001234']) {
        expect(phone.replace(/[^\d+]/g, '')).toBe(phone);
      }
    });
  });

  it('SĐT không phải chuỗi → 400, không lọt qua như bỏ trống', async () => {
    expect(await messagesOf(CreateRefillLocationDto, { name: 'A', address: 'B', phone: 901234567 })).toEqual(
      expect.arrayContaining([PHONE_MESSAGE]),
    );
  });

  it('giới hạn độ dài tên 100, địa chỉ 300, giờ 120', async () => {
    expect(await messagesOf(CreateRefillLocationDto, { name: 'x'.repeat(101), address: 'y'.repeat(301), hours: 'z'.repeat(121) })).toEqual([
      'Tên điểm nhận không được dài quá 100 ký tự.',
      'Địa chỉ điểm nhận không được dài quá 300 ký tự.',
      'Giờ mở cửa không được dài quá 120 ký tự.',
    ]);
    await expect(run(CreateRefillLocationDto, { name: 'x'.repeat(100), address: 'y'.repeat(300), hours: 'z'.repeat(120) })).resolves.toBeDefined();
  });

  it('isActive phải là boolean; trường lạ bị từ chối', async () => {
    expect(await messagesOf(CreateRefillLocationDto, { name: 'A', address: 'B', isActive: 'yes' })).toEqual([
      'Trạng thái hoạt động chỉ nhận đúng hoặc sai.',
    ]);
    expect(await messagesOf(CreateRefillLocationDto, { name: 'A', address: 'B', sortOrder: 3 })).toEqual(['Không nhận trường «sortOrder».']);
  });
});

describe('UpdateRefillLocationDto', () => {
  it('mọi trường tuỳ chọn; null ở giờ/SĐT được nhận (xoá)', async () => {
    await expect(run(UpdateRefillLocationDto, {})).resolves.toBeDefined();
    await expect(run(UpdateRefillLocationDto, { hours: null, phone: null })).resolves.toMatchObject({ hours: null, phone: null });
  });

  it('đã gửi tên/địa chỉ thì không được trống', async () => {
    expect(await messagesOf(UpdateRefillLocationDto, { name: ' ' })).toEqual(['Tên điểm nhận không được để trống.']);
    expect(await messagesOf(UpdateRefillLocationDto, { address: '' })).toEqual(['Địa chỉ điểm nhận không được để trống.']);
  });
});

describe('ReorderRefillLocationsDto', () => {
  it('nhận mảng id không lặp', async () => {
    await expect(run(ReorderRefillLocationsDto, { ids: ['a', 'b'] })).resolves.toMatchObject({ ids: ['a', 'b'] });
  });

  it('rỗng, lặp id hoặc không phải mảng → 400', async () => {
    expect(await messagesOf(ReorderRefillLocationsDto, { ids: [] })).toEqual(['Danh sách thứ tự không được để trống.']);
    expect(await messagesOf(ReorderRefillLocationsDto, { ids: ['a', 'a'] })).toEqual(['Danh sách thứ tự có id bị lặp.']);
    expect(await messagesOf(ReorderRefillLocationsDto, { ids: 'a' })).toEqual(
      expect.arrayContaining(['Danh sách thứ tự phải là một mảng id.']),
    );
  });
});
