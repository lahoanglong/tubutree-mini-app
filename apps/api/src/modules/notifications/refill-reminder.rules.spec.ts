import {
  REFILL_REMINDER_DAYS,
  REFILL_REMINDER_TEMPLATE,
  pickRefillReminder,
  refillReminderDedupeKey,
  refillReminderOptedOut,
  refillReminderWindow,
} from './refill-reminder.rules';
import { notificationCategory, isAllowedByPrefs } from './notification-categories';
import { notificationDelivery } from './notification-delivery';
import { MARKETING_TEMPLATE_CODES } from './notification-templates-admin.service';

const pairs = new Map([
  ['bottle-a', 'refill-a'],
  ['bottle-b', 'refill-b'],
]);

const base = { bottleIds: ['bottle-a'], pairs, reorderedRefillIds: new Set<string>(), optedOut: false, recentlyReminded: false };

describe('pickRefillReminder', () => {
  it('chai có cặp Refill đang bán: nhắc đúng gói Refill của chai', () => {
    expect(pickRefillReminder(base)).toEqual({ outcome: 'SEND', bottleId: 'bottle-a', refillId: 'refill-a' });
  });

  it('không chai nào có cặp: không ghi gì (admin ghép cặp trong cửa sổ thì lượt sau vẫn nhắc)', () => {
    expect(pickRefillReminder({ ...base, bottleIds: ['bottle-x'] })).toEqual({ outcome: 'NO_PAIR' });
  });

  it('khách đã mua lại gói Refill trong 21 ngày: bỏ qua', () => {
    expect(pickRefillReminder({ ...base, reorderedRefillIds: new Set(['refill-a']) })).toEqual({ outcome: 'REORDERED' });
  });

  it('đơn có hai chai, gói của chai đầu đã mua lại: nhắc gói của chai còn lại', () => {
    expect(pickRefillReminder({ ...base, bottleIds: ['bottle-a', 'bottle-b'], reorderedRefillIds: new Set(['refill-a']) })).toEqual({
      outcome: 'SEND',
      bottleId: 'bottle-b',
      refillId: 'refill-b',
    });
  });

  it('khách tắt tin khuyến mãi / MSS báo từ chối: bỏ qua, xét trước mọi thứ khác', () => {
    expect(pickRefillReminder({ ...base, optedOut: true })).toEqual({ outcome: 'OPTED_OUT' });
    expect(pickRefillReminder({ ...base, optedOut: true, reorderedRefillIds: new Set(['refill-a']) })).toEqual({ outcome: 'OPTED_OUT' });
  });

  it('khách vừa nhận một tin nhắc Refill trong 7 ngày: hoãn (không ghi, không gửi)', () => {
    expect(pickRefillReminder({ ...base, recentlyReminded: true })).toEqual({ outcome: 'CAPPED' });
  });
});

describe('refillReminderOptedOut', () => {
  const user = { notifyPromo: true, notifyOrderZalo: false, notifyOrderZaloSource: null, isBlocked: false };
  it('khách bật tin khuyến mãi: được nhắc', () => {
    expect(refillReminderOptedOut(user)).toBe(false);
  });
  it('tắt tin khuyến mãi, bị khoá, hay MSS báo khách từ chối tin Zalo: không nhắc', () => {
    expect(refillReminderOptedOut({ ...user, notifyPromo: false })).toBe(true);
    expect(refillReminderOptedOut({ ...user, isBlocked: true })).toBe(true);
    expect(refillReminderOptedOut({ ...user, notifyOrderZaloSource: 'mss_opt_out' })).toBe(true);
  });
  it('chưa từng đồng ý tin đơn qua Zalo (mặc định) không phải là từ chối', () => {
    expect(refillReminderOptedOut({ ...user, notifyOrderZalo: false, notifyOrderZaloSource: 'checkout' })).toBe(false);
  });
});

describe('refillReminderWindow', () => {
  it('đơn giao từ 21 tới 28 ngày trước; mua lại tính trong 21 ngày; mỗi khách tối đa một tin / 7 ngày', () => {
    const now = new Date('2026-11-21T02:30:00.000Z');
    const day = 864e5;
    const w = refillReminderWindow(now);
    expect(REFILL_REMINDER_DAYS).toBe(21);
    expect(now.getTime() - w.dueBefore.getTime()).toBe(21 * day);
    expect(now.getTime() - w.oldest.getTime()).toBe(28 * day);
    expect(w.reorderedSince.getTime()).toBe(w.dueBefore.getTime());
    expect(now.getTime() - w.userGapSince.getTime()).toBe(7 * day);
  });
});

describe('mẫu tin REORDER_REMINDER_REFILL', () => {
  it('khoá chống trùng theo đơn', () => {
    expect(refillReminderDedupeKey('ord_1')).toBe('refill21d:ord_1');
  });
  it('là tin khuyến mãi: theo công tắc "Khuyến mãi", trần tin chủ động nhóm reorder, Marketing sửa được', () => {
    expect(REFILL_REMINDER_TEMPLATE).toBe('REORDER_REMINDER_REFILL');
    expect(notificationCategory(REFILL_REMINDER_TEMPLATE)).toBe('PROMO');
    expect(isAllowedByPrefs(REFILL_REMINDER_TEMPLATE, { notifyPromo: false, notifyGarden: true, notifySocial: true })).toBe(false);
    expect(notificationDelivery(REFILL_REMINDER_TEMPLATE)).toEqual(notificationDelivery('REORDER_REMINDER'));
    expect(MARKETING_TEMPLATE_CODES.has(REFILL_REMINDER_TEMPLATE)).toBe(true);
  });
});
