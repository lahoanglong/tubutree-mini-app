// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { EMPTY_BANK, type RefundBankInput, type RefundMethodChoice } from '@/lib/refund-rules';

const m = vi.hoisted(() => ({ fetchRefundBank: vi.fn() }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchRefundBank: () => m.fetchRefundBank(),
}));

import { RefundDestinationPicker } from './refund-destination-picker';

const SAVED: RefundBankInput = { bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'NGUYEN AN' };

/** Cha giữ state như order-actions / return-request-form: onBank nhận trực tiếp setState. */
function Harness({ initialBank = EMPTY_BANK }: { initialBank?: RefundBankInput }) {
  const [method, setMethod] = useState<RefundMethodChoice>('WALLET');
  const [bank, setBank] = useState<RefundBankInput>(initialBank);
  return <RefundDestinationPicker method={method} onMethod={setMethod} bank={bank} onBank={setBank} bankError={null} />;
}

let mounted: Rendered[] = [];
beforeEach(() => m.fetchRefundBank.mockReset().mockResolvedValue(SAVED));
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const field = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;
const pickBank = async (r: Rendered) => {
  click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="BANK"]'));
  await flush(6);
};

describe('RefundDestinationPicker — điền sẵn tài khoản ngân hàng đã lưu', () => {
  it('chọn ngân hàng lần đầu: điền sẵn cả ba ô từ tài khoản dùng gần nhất', async () => {
    const r = mount(<Harness />);
    expect(m.fetchRefundBank).not.toHaveBeenCalled();
    await pickBank(r);
    expect(field(r, 'Tên ngân hàng').value).toBe('Vietcombank');
    expect(field(r, 'Số tài khoản').value).toBe('0123456789');
    expect(field(r, 'Chủ tài khoản').value).toBe('NGUYEN AN');
  });

  it('khách xoá ô số tài khoản để gõ lại: không điền đè lên tên ngân hàng / chủ tài khoản vừa sửa', async () => {
    const r = mount(<Harness />);
    await pickBank(r);
    typeInto(field(r, 'Tên ngân hàng'), 'Techcombank');
    typeInto(field(r, 'Chủ tài khoản'), 'TRAN BINH');
    typeInto(field(r, 'Số tài khoản'), '');
    await flush(6);
    expect(field(r, 'Tên ngân hàng').value).toBe('Techcombank');
    expect(field(r, 'Chủ tài khoản').value).toBe('TRAN BINH');
    expect(field(r, 'Số tài khoản').value).toBe('');
    expect(m.fetchRefundBank).toHaveBeenCalledTimes(1);
  });

  it('chuyển Ví → Ngân hàng → Ví → Ngân hàng: giữ nguyên số khách đã sửa, không gọi lại API', async () => {
    const r = mount(<Harness />);
    await pickBank(r);
    typeInto(field(r, 'Tên ngân hàng'), 'Techcombank');
    click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="WALLET"]'));
    await flush(2);
    await pickBank(r);
    expect(field(r, 'Tên ngân hàng').value).toBe('Techcombank');
    expect(m.fetchRefundBank).toHaveBeenCalledTimes(1);
  });

  it('khách gõ trước khi API trả về: không bị điền đè', async () => {
    let release!: (b: RefundBankInput) => void;
    m.fetchRefundBank.mockReturnValue(new Promise<RefundBankInput>((res) => (release = res)));
    const r = mount(<Harness />);
    click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="BANK"]'));
    await flush(2);
    typeInto(field(r, 'Tên ngân hàng'), 'MB Bank');
    release(SAVED);
    await flush(6);
    expect(field(r, 'Tên ngân hàng').value).toBe('MB Bank');
    expect(field(r, 'Số tài khoản').value).toBe('');
  });

  it('đã có sẵn dữ liệu trong ô (vd lấy từ khoản hoàn cũ): không gọi API, không điền đè', async () => {
    const r = mount(<Harness initialBank={{ bankName: 'ACB', accountNumber: '999888777', accountName: 'LE CHI' }} />);
    await pickBank(r);
    expect(m.fetchRefundBank).not.toHaveBeenCalled();
    expect(field(r, 'Tên ngân hàng').value).toBe('ACB');
  });

  it('chưa có tài khoản đã lưu: để trống ba ô', async () => {
    m.fetchRefundBank.mockResolvedValue(null);
    const r = mount(<Harness />);
    await pickBank(r);
    expect(field(r, 'Số tài khoản').value).toBe('');
  });
});
