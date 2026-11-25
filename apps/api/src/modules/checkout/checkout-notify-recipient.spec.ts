import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PlaceOrderDto } from './dto/checkout.dto';
import { notifyRecipientZaloOf } from './notify-recipient';

/**
 * PO A1 (w35-01): công tắc "gửi thêm thông báo giao hàng (không kèm giá) cho số người nhận" ở bước đặt hàng. Tách khỏi checkout.service.spec
 * (khoá của wave khác); ghi thật xuống Postgres và đọc lại lúc ghi sự kiện ở test/integration-race/mss-order-events.race-spec.ts (11).
 */
describe('PlaceOrderDto.notifyRecipientZalo', () => {
  const base = { addressId: 'a1', paymentMethod: 'COD' };
  const errs = async (plain: Record<string, unknown>) => (await validate(plainToInstance(PlaceOrderDto, { ...base, ...plain }))).filter((e) => e.property === 'notifyRecipientZalo');

  it('tuỳ chọn, chỉ nhận boolean', async () => {
    expect(await errs({})).toHaveLength(0);
    expect(await errs({ notifyRecipientZalo: true })).toHaveLength(0);
    expect(await errs({ notifyRecipientZalo: false })).toHaveLength(0);
    expect((await errs({ notifyRecipientZalo: 'true' }))[0]?.constraints).toHaveProperty('isBoolean');
  });
});

describe('notifyRecipientZaloOf (cột orders.notifyRecipientZalo lúc đặt)', () => {
  it.each([
    [{ notifyRecipientZalo: true, orderZaloConsent: true }, true],
    [{ notifyRecipientZalo: true, orderZaloConsent: false }, false],
    [{ notifyRecipientZalo: true }, false],
    [{ notifyRecipientZalo: false, orderZaloConsent: true }, false],
    [{ orderZaloConsent: true }, false],
    [{}, false],
  ])('%j → %s: chỉ ghi khi cùng lần đặt có đồng ý nhận tin Zalo', (dto, want) => {
    expect(notifyRecipientZaloOf(dto)).toBe(want);
  });

  it('checkout.service ghi đúng giá trị này lên mọi đơn của lần đặt; đặt hàng vãng lai không chuyển công tắc (một số điện thoại)', () => {
    const service = readFileSync(join(__dirname, 'checkout.service.ts'), 'utf8');
    const create = service.slice(service.indexOf('await tx.order.create({'), service.indexOf('await this.mssOrderEvents?.onOrdersPlaced('));
    expect(create).toContain('notifyRecipientZalo: notifyRecipientZaloOf(dto),');
    const guest = readFileSync(join(__dirname, 'guest', 'guest-checkout.service.ts'), 'utf8');
    expect(guest).not.toContain('notifyRecipientZalo');
  });
});
