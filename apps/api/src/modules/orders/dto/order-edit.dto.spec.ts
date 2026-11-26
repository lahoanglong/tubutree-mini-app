import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../common/validation-pipe';
import { EditOrderDeliveryDto } from './order-edit.dto';

/** ValidationPipe toàn cục ở main.ts. */
const pipe = createValidationPipe();
const asBody = (value: Record<string, unknown>) => pipe.transform(value, { type: 'body', metatype: EditOrderDeliveryDto, data: undefined });

const ADDRESS = {
  recipient: 'Trần Thị B',
  phone: '0900000002',
  ward: 'Phường Sài Gòn',
  street: '9 Pasteur',
  provinceCode: '84_VN79',
  districtCode: '',
  wardCode: '84_VN7926740',
};
const REQUIRED = 'Bạn điền đủ người nhận, số điện thoại, phường/xã và số nhà nhé.';
const NO_HTML = 'Tên người nhận và địa chỉ không được chứa ký tự < hoặc >.';

/** Lỗi 400 của pipe dưới dạng chuỗi (null = hợp lệ). */
async function rejection(body: Record<string, unknown>): Promise<string | null> {
  try {
    await asBody(body);
    return null;
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
    return JSON.stringify(e.getResponse());
  }
}

describe('EditOrderDeliveryDto — địa chỉ khách tự sửa', () => {
  it('địa chỉ đủ ô, ghi chú null → hợp lệ; ô chữ được cắt khoảng trắng', async () => {
    expect(await rejection({ address: ADDRESS, note: null })).toBeNull();
    const dto = (await asBody({ address: { ...ADDRESS, street: '  9 Pasteur  ' } })) as EditOrderDeliveryDto;
    expect(dto.address?.street).toBe('9 Pasteur');
  });

  it.each(['recipient', 'ward', 'street'])('%s rỗng hoặc chỉ có khoảng trắng → 400 bảo điền đủ', async (field) => {
    for (const value of ['', '   ']) {
      expect(await rejection({ address: { ...ADDRESS, [field]: value } })).toContain(REQUIRED);
    }
  });

  it.each(['recipient', 'ward', 'street'])('%s có < hoặc > → 400 (chữ đi thẳng vào nhãn Pancake)', async (field) => {
    expect(await rejection({ address: { ...ADDRESS, [field]: 'Phường <b>Sài Gòn</b>' } })).toContain(NO_HTML);
  });

  it('SĐT sai dạng hay tỉnh chưa theo địa giới mới → 400', async () => {
    expect(await rejection({ address: { ...ADDRESS, phone: '12345' } })).toContain('Số điện thoại không hợp lệ');
    expect(await rejection({ address: { ...ADDRESS, provinceCode: '79' } })).toContain('địa giới mới');
  });
});
