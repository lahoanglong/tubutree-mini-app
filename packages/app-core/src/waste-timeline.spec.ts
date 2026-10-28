import { describe, expect, it } from 'vitest';
import { TIMELINE_STEPS, timelineFor } from './waste-timeline';

describe('TIMELINE_STEPS', () => {
  it('tên bước từng đường; bước 3 của thu kèm đơn là "Kho nhận, đếm"', () => {
    expect(TIMELINE_STEPS.MAIL_IN).toEqual(['Gửi kiện', 'Vận chuyển', 'Đã nhận ở kho', 'Cộng điểm']);
    expect(TIMELINE_STEPS.DROP_OFF).toEqual(['Đã tạo', 'Mang tới điểm', 'Điểm nhận đếm', 'Cộng điểm']);
    expect(TIMELINE_STEPS.PICKUP).toEqual(['Đã tạo', 'Gắn vào đơn', 'Kho nhận, đếm', 'Cộng điểm']);
  });
});

describe('timelineFor: current là chỉ số bước đang diễn ra, 4 là xong hết', () => {
  const t = (method: 'MAIL_IN' | 'DROP_OFF' | 'PICKUP', status: string, orderCode: string | null = null) =>
    timelineFor({ method, status: status as never, orderCode });

  it.each([
    ['MAIL_IN', 'OPEN', null, 0],
    ['MAIL_IN', 'IN_TRANSIT', null, 1],
    ['MAIL_IN', 'RECEIVED', null, 2],
    ['MAIL_IN', 'COMPLETED', null, 4],
    ['DROP_OFF', 'OPEN', null, 1],
    ['DROP_OFF', 'COMPLETED', null, 4],
    ['PICKUP', 'OPEN', null, 1],
    ['PICKUP', 'OPEN', 'TUBU123', 2],
    ['PICKUP', 'IN_TRANSIT', 'TUBU123', 2],
    ['PICKUP', 'RECEIVED', 'TUBU123', 3],
    ['PICKUP', 'COMPLETED', 'TUBU123', 4],
  ] as const)('%s %s (đơn %s) -> %i', (method, status, orderCode, current) => {
    expect(t(method, status, orderCode)?.current).toBe(current);
  });

  it('PICKUP đã RECEIVED: bước "Kho nhận, đếm" đã qua, đang tới "Cộng điểm"; chưa RECEIVED thì còn đang ở bước kho', () => {
    const received = t('PICKUP', 'RECEIVED', 'TUBU123')!;
    expect(received.steps[received.current - 1]).toBe('Kho nhận, đếm');
    expect(received.steps[received.current]).toBe('Cộng điểm');
    const waiting = t('PICKUP', 'IN_TRANSIT', 'TUBU123')!;
    expect(waiting.steps[waiting.current]).toBe('Kho nhận, đếm');
  });

  it.each(['REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED'])('%s thay timeline bằng nhãn (null)', (status) => {
    expect(t('MAIL_IN', status)).toBeNull();
  });
});
