import { readFileSync } from 'fs';
import { join } from 'path';
import { composeSubscriptionNote, customerFacingNote, SUBSCRIPTION_NOTE_SEP, SUBSCRIPTION_ORDER_NOTE, subscriptionCustomerPart } from './subscription-note';

const MARK = SUBSCRIPTION_ORDER_NOTE;

describe('subscription-note', () => {
  it('dấu trùng chữ với SUBSCRIPTION_ORDER_NOTE của app-core (client nhận ra đơn định kỳ bằng đúng chữ này)', () => {
    const appCore = readFileSync(join(__dirname, '../../../../../packages/app-core/src/api/orders.ts'), 'utf8');
    expect(appCore).toContain(`SUBSCRIPTION_ORDER_NOTE = '${MARK}'`);
  });

  it('subscriptionCustomerPart: đúng dấu hoặc trống → null; có dấu ở đầu → phần sau; không có dấu → nguyên ghi chú', () => {
    expect(subscriptionCustomerPart(MARK)).toBeNull();
    expect(subscriptionCustomerPart(` ${MARK} `)).toBeNull();
    expect(subscriptionCustomerPart(null)).toBeNull();
    expect(subscriptionCustomerPart('   ')).toBeNull();
    expect(subscriptionCustomerPart(`${MARK}${SUBSCRIPTION_NOTE_SEP}Giao giờ HC`)).toBe('Giao giờ HC');
    expect(subscriptionCustomerPart(`${MARK} ·  Giao giờ HC  `)).toBe('Giao giờ HC');
    expect(subscriptionCustomerPart(`${MARK} ·`)).toBeNull();
    expect(subscriptionCustomerPart('Giao giờ HC')).toBe('Giao giờ HC');
    // Chữ dính liền sau dấu không phải phần của khách theo khuôn: giữ nguyên để không cắt mất chữ.
    expect(subscriptionCustomerPart(`${MARK}abc`)).toBe(`${MARK}abc`);
  });

  it('composeSubscriptionNote: trống → đúng dấu; có chữ → `dấu · chữ` (trim)', () => {
    expect(composeSubscriptionNote(null)).toBe(MARK);
    expect(composeSubscriptionNote('  ')).toBe(MARK);
    expect(composeSubscriptionNote(' Giao giờ HC ')).toBe(`${MARK}${SUBSCRIPTION_NOTE_SEP}Giao giờ HC`);
    expect(subscriptionCustomerPart(composeSubscriptionNote('Gọi trước'))).toBe('Gọi trước');
  });

  it('customerFacingNote: đơn định kỳ trả phần của khách, hoặc đúng dấu khi khách chưa viết; đơn khác trả nguyên ghi chú', () => {
    expect(customerFacingNote({ source: 'subscription', note: `${MARK}${SUBSCRIPTION_NOTE_SEP}Giao giờ HC` })).toBe('Giao giờ HC');
    expect(customerFacingNote({ source: 'subscription', note: MARK })).toBe(MARK);
    expect(customerFacingNote({ source: 'subscription', note: null })).toBeNull();
    expect(customerFacingNote({ source: 'subscription', note: 'ghi chú cũ' })).toBe('ghi chú cũ');
    expect(customerFacingNote({ source: 'checkout', note: `${MARK}${SUBSCRIPTION_NOTE_SEP}x` })).toBe(`${MARK}${SUBSCRIPTION_NOTE_SEP}x`);
    expect(customerFacingNote({ source: null, note: ' a ' })).toBe(' a ');
  });
});
