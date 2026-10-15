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

  it.each(['0901234567', '+84901234567', ''])('SĐT %p hợp lệ (rỗng = không có số)', async (phone) => {
    await expect(run(CreateRefillLocationDto, { name: 'A', address: 'B', phone })).resolves.toMatchObject({ phone });
  });

  it.each(['090123456', '09012345678', '84901234567', '0901 234 567', 'abc', '+8490123456'])('SĐT %p sai dạng → 400', async (phone) => {
    expect(await messagesOf(CreateRefillLocationDto, { name: 'A', address: 'B', phone })).toEqual([
      'SĐT điểm nhận phải để trống hoặc là 10 số bắt đầu bằng 0 hoặc +84.',
    ]);
  });

  it('SĐT không phải chuỗi → 400, không lọt qua như bỏ trống', async () => {
    expect(await messagesOf(CreateRefillLocationDto, { name: 'A', address: 'B', phone: 901234567 })).toEqual(
      expect.arrayContaining(['SĐT điểm nhận phải để trống hoặc là 10 số bắt đầu bằng 0 hoặc +84.']),
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
