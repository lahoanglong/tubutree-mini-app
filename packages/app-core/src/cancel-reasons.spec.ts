import { describe, expect, it } from 'vitest';
import { CANCEL_REASONS, CANCEL_REASON_TEXT_MAX, cancelReasonBody } from './cancel-reasons';

describe('cancelReasonBody', () => {
  it('lời viết thêm chỉ đi kèm "Lý do khác", cắt khoảng trắng và giới hạn độ dài', () => {
    expect(cancelReasonBody('CHANGED_MIND', 'bỏ qua')).toEqual({ cancelReasonCode: 'CHANGED_MIND' });
    expect(cancelReasonBody('OTHER', '   ')).toEqual({ cancelReasonCode: 'OTHER' });
    expect(cancelReasonBody('OTHER', '  Con ốm  ')).toEqual({ cancelReasonCode: 'OTHER', cancelReasonText: 'Con ốm' });
    expect(cancelReasonBody('OTHER', 'x'.repeat(500)).cancelReasonText).toHaveLength(CANCEL_REASON_TEXT_MAX);
  });
  it('mã trùng bảng của API', () => {
    expect(CANCEL_REASONS.map((r) => r.code)).toEqual(['CHANGED_MIND', 'WRONG_ORDER', 'CHANGE_DETAILS', 'FOUND_BETTER', 'OTHER']);
  });
});
