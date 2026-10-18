import * as C from './waste.constants';

describe('waste constants', () => {
  it('pins the lock classes, consent version and numeric limits', () => {
    expect(C.WASTE_LOCK_CLASS).toEqual({ CUSTOMER: 731001, TRACKING: 731002, STAFF_CAP: 731003, POINT_CREATE: 731004 });
    expect(C.WASTE_CONSENT_VERSION).toBe('2026-10-17.1');
    expect([C.WASTE_REQUEST_POINTS_MAX, C.WASTE_POINTS_MAX_PER_SITE, C.WASTE_MAX_STAFF_PER_POINT, C.WASTE_RECEIVE_REPLAY_MS, C.WASTE_DESK_RECENT_MS, C.WASTE_MAX_REQUEST_LINES]).toEqual([2_000_000, 200, 5, 600_000, 86_400_000, 50]);
  });
  it('pins the status lists', () => {
    expect([...C.GOMDON_DISPATCHED_STATUSES]).toEqual(['3', '4', '5', '7']);
    expect([...C.WASTE_OPEN_STATUSES]).toEqual(['OPEN', 'IN_TRANSIT', 'RECEIVED']);
    expect([...C.WASTE_CAP_STATUSES]).toEqual(['OPEN', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'REVERSED']);
  });
  it('the code alphabet has 30 characters, none of 0 O 1 I L U, and equals the lookup character class', () => {
    expect(C.WASTE_CODE_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(C.WASTE_CODE_ALPHABET).toHaveLength(30);
    const inClass = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((ch) => /[2-9A-HJKMNP-TV-Z]/.test(ch)).join('');
    expect(inClass).toBe(C.WASTE_CODE_ALPHABET);
  });
  it('the lookup pattern accepts TR- plus 5 and QG- plus 8 characters only', () => {
    for (const ok of ['TR-A2C4E', 'QG-23456789']) expect(C.WASTE_LOOKUP_PATTERN.test(ok)).toBe(true);
    for (const bad of ['TR-A2C4', 'TR-A2C4EF', 'QG-2345678', 'TR-A2C4I', 'TR-A2C40', 'tr-a2c4e', 'TUBU1234', '0901234567', 'QG-2345678O']) {
      expect(C.WASTE_LOOKUP_PATTERN.test(bad)).toBe(false);
    }
  });
  it('WASTE_EVENT_KINDS has exactly the 41 UPPER_SNAKE values of registry 4.3, in order', () => {
    expect(C.WASTE_EVENT_KINDS).toHaveLength(41);
    expect([...C.WASTE_EVENT_KINDS]).toEqual([
      'REQUEST_CREATED', 'REQUEST_EDITED', 'TRACKING_SET', 'TRACKING_EDITED', 'REQUEST_CANCELLED', 'REQUEST_ATTACHED', 'PICKUP_STARTED',
      'PICKUP_ORDER_CANCELLED', 'REQUEST_EXPIRED', 'HOOK_ANOMALY', 'SHIP_LOCKED', 'REQUEST_CANCELLED_SHIP_LOCK', 'PARCEL_RECEIVED', 'PARCEL_UNMATCHED',
      'UNMATCHED_RECORDED', 'UNMATCHED_RESOLVED', 'UNMATCHED_CLOSED', 'REQUEST_CONFIRMED', 'REQUEST_REJECTED', 'LOOKUP_MISS', 'POINTS_REVERSED',
      'REQUEST_CLOSED_LOST', 'REQUEST_REOPENED', 'REQUEST_COST_UPDATED', 'PERK_SUBMITTED', 'PERK_APPROVED', 'PERK_REJECTED', 'ITEM_CREATED',
      'ITEM_UPDATED', 'ITEMS_REORDERED', 'POINT_CREATED', 'POINT_UPDATED', 'POINTS_REORDERED', 'POINT_STAFF_ADDED', 'POINT_STAFF_REMOVED',
      'GIFT_CREATED', 'GIFT_UPDATED', 'GIFTS_REORDERED', 'GIFT_FULFILLED', 'GIFT_CANCELLED', 'USER_FLAGS_UPDATED',
    ]);
    expect(new Set(C.WASTE_EVENT_KINDS).size).toBe(41);
    for (const k of C.WASTE_EVENT_KINDS) expect(k).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
  });
});
