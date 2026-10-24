import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SendMessageDto } from './send-message.dto';

const errs = (o: object) => validateSync(plainToInstance(SendMessageDto, o));
const base = { clientMsgId: 'abcdefgh-1234' };

describe('SendMessageDto', () => {
  it('hợp lệ', () => {
    expect(errs({ ...base, body: 'xin chào', context: { orderCode: 'TT1' } })).toHaveLength(0);
    expect(errs({ ...base, imageUrl: 'https://res.cloudinary.com/x/image/upload/a.jpg', source: 'WEB' })).toHaveLength(0);
  });
  it('body 1.001 ký tự lỗi, 1.000 được', () => {
    expect(errs({ ...base, body: 'a'.repeat(1001) })).not.toHaveLength(0);
    expect(errs({ ...base, body: 'a'.repeat(1000) })).toHaveLength(0);
  });
  it('imageUrl phải là https://res.cloudinary.com, không nhận base64', () => {
    expect(errs({ ...base, imageUrl: 'https://evil.example.com/a.jpg' })).not.toHaveLength(0);
    expect(errs({ ...base, imageUrl: 'data:image/jpeg;base64,AAAA' })).not.toHaveLength(0);
  });
  it('context.orderCode tối đa 40 ký tự', () => {
    expect(errs({ ...base, body: 'x', context: { orderCode: 'a'.repeat(41) } })).not.toHaveLength(0);
    expect(errs({ ...base, body: 'x', context: { orderCode: 'a'.repeat(40) } })).toHaveLength(0);
  });
  it('context dạng mảng bị từ chối', () => {
    expect(errs({ ...base, body: 'x', context: [{ orderCode: 'a' }] })).not.toHaveLength(0);
  });
  it('clientMsgId bắt buộc, source chỉ MINIAPP|WEB', () => {
    expect(errs({ body: 'x' })).not.toHaveLength(0);
    expect(errs({ ...base, body: 'x', source: 'ZALO' })).not.toHaveLength(0);
  });
});
