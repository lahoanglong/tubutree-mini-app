import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShiftTemplateDto, UpdateShiftTemplateDto } from './shift.dto';

const errorsOf = async (cls: new () => object, plain: object) => (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('DTO ca chuẩn: tên không rỗng sau khi cắt khoảng trắng', () => {
  it.each(['', '   ', '\t\n'])('tạo với tên %j bị từ chối', async (name) => {
    expect(await errorsOf(ShiftTemplateDto, { name, startMin: 480, endMin: 720 })).toContain('name');
  });
  it('sửa sang tên toàn khoảng trắng bị từ chối', async () => {
    expect(await errorsOf(UpdateShiftTemplateDto, { name: '   ' })).toContain('name');
  });
  it('tên hợp lệ và sửa không gửi tên vẫn qua', async () => {
    expect(await errorsOf(ShiftTemplateDto, { name: ' Ca sáng ', startMin: 480, endMin: 720 })).toEqual([]);
    expect(await errorsOf(UpdateShiftTemplateDto, { startMin: 480 })).toEqual([]);
  });
});
