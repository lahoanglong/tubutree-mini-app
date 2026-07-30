import 'reflect-metadata';
import { validate, type ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PlaceOrderForCustomerDto } from './place-order-for-customer.dto';

async function errorKeys(plain: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(PlaceOrderForCustomerDto, plain);
  const errs = await validate(dto, { whitelist: true });
  // Gộp cả constraint cấp cha lẫn con (nested) để test dễ khẳng định.
  const walk = (e: ValidationError[]): string[] =>
    e.flatMap((x) => [...Object.keys(x.constraints ?? {}), ...walk(x.children ?? [])]);
  return walk(errs);
}

const CUSTOMER = {
  recipient: 'Khách A',
  phone: '0900000000',
  province: 'Hà Nội',
  ward: 'Phường 1',
  street: 'Số 1',
  provinceCode: '84_VN01',
  wardCode: '84_VN0101',
};

const VALID = {
  items: [{ variationId: 'v1', quantity: 2 }],
  customer: CUSTOMER,
  paymentMethod: 'COD',
};

describe('PlaceOrderForCustomerDto', () => {
  it('hợp lệ (COD) → không lỗi', async () => {
    expect(await errorKeys(VALID)).toHaveLength(0);
  });

  it('hợp lệ (BANK_TRANSFER) → không lỗi', async () => {
    expect(await errorKeys({ ...VALID, paymentMethod: 'BANK_TRANSFER' })).toHaveLength(0);
  });

  it('items rỗng → lỗi arrayMinSize', async () => {
    expect(await errorKeys({ ...VALID, items: [] })).toContain('arrayMinSize');
  });

  it('quantity 0 → lỗi min (nested)', async () => {
    const keys = await errorKeys({ ...VALID, items: [{ variationId: 'v1', quantity: 0 }] });
    expect(keys).toContain('min');
  });

  it('paymentMethod ngoài COD/BANK_TRANSFER → lỗi isIn (chặn WALLET/XU)', async () => {
    expect(await errorKeys({ ...VALID, paymentMethod: 'WALLET' })).toContain('isIn');
  });

  it('thiếu recipient trong customer → lỗi (nested)', async () => {
    const keys = await errorKeys({ ...VALID, customer: { ...CUSTOMER, recipient: undefined } });
    expect(keys).toContain('isString');
  });
});
