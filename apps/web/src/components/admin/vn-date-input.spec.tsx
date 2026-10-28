// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act } from 'react';
import { flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { VnDateInput, VnMonthInput, isoToVn, maskVnDate, vnToIso } from './vn-date-input';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('helper ngày dd/mm/yyyy', () => {
  it('đổi qua lại giữa yyyy-mm-dd và dd/mm/yyyy; từ chối ngày không có thật', () => {
    expect(isoToVn('2026-10-03')).toBe('03/10/2026');
    expect(isoToVn('')).toBe('');
    expect(vnToIso('03/10/2026')).toBe('2026-10-03');
    expect(vnToIso('31/02/2026')).toBeNull();
    expect(vnToIso('3/10/2026')).toBeNull();
    expect(vnToIso('29/02/2028')).toBe('2028-02-29');
  });
  it('mặt nạ tự chèn dấu "/", bỏ ký tự lạ, tối đa 8 số', () => {
    expect(maskVnDate('0310')).toBe('03/10');
    expect(maskVnDate('03102026')).toBe('03/10/2026');
    expect(maskVnDate('03a10b20261234')).toBe('03/10/2026');
    expect(maskVnDate('1')).toBe('1');
    expect(maskVnDate('3/10/2026')).toBe('03/10/2026');
    expect(maskVnDate('3/')).toBe('03/');
    expect(maskVnDate('3.1.2026')).toBe('03/01/2026');
    expect(maskVnDate('03/1')).toBe('03/1');
    expect(maskVnDate('2026-10-03')).toBe('03/10/2026');
    expect(maskVnDate(' 2026-1-3 ')).toBe('03/01/2026');
  });
});

describe('VnDateInput', () => {
  function Harness({ min, max, onValue }: { min?: string; max?: string; onValue: (v: string) => void }) {
    const [v, setV] = useState('');
    return (
      <>
        <VnDateInput value={v} min={min} max={max} ariaLabel="Từ ngày" onChange={(x) => { setV(x); onValue(x); }} />
        <button type="button" data-reset onClick={() => setV('')}>x</button>
      </>
    );
  }
  const field = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Từ ngày"]')!;

  it('hiện placeholder dd/mm/yyyy (không phải mm/dd/yyyy gốc); gõ đủ ngày thì báo ISO, chưa đủ thì chưa báo', async () => {
    const onValue = vi.fn();
    const r = render(<Harness onValue={onValue} />);
    mounted.push(r);
    expect(field(r.container).placeholder).toBe('dd/mm/yyyy');
    typeInto(field(r.container), '0310');
    expect(onValue).not.toHaveBeenCalled();
    typeInto(field(r.container), '03102026');
    await flush();
    expect(field(r.container).value).toBe('03/10/2026');
    expect(onValue).toHaveBeenLastCalledWith('2026-10-03');
  });

  it('ngày không có thật thì không báo; ngày ngoài khoảng min/max vẫn báo cho cha (cha tự nói lỗi khoảng ngày) nhưng ô đánh dấu lỗi sau khi rời ô', async () => {
    const onValue = vi.fn();
    const r = render(<Harness min="2026-10-05" onValue={onValue} />);
    mounted.push(r);
    typeInto(field(r.container), '31022026');
    act(() => field(r.container).dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(onValue).not.toHaveBeenCalled();
    expect(field(r.container).getAttribute('aria-invalid')).toBe('true');
    typeInto(field(r.container), '03102026');
    await flush();
    expect(onValue).toHaveBeenLastCalledWith('2026-10-03');
    expect(field(r.container).getAttribute('aria-invalid')).toBe('true');
  });

  it('xoá hết thì báo rỗng; cha đặt lại giá trị thì ô chữ theo', async () => {
    const onValue = vi.fn();
    const r = render(<Harness onValue={onValue} />);
    mounted.push(r);
    typeInto(field(r.container), '03102026');
    await flush();
    typeInto(field(r.container), '');
    expect(onValue).toHaveBeenLastCalledWith('');
    typeInto(field(r.container), '03102026');
    await flush();
    act(() => r.container.querySelector<HTMLButtonElement>('[data-reset]')!.click());
    await flush();
    expect(field(r.container).value).toBe('');
  });
});

describe('VnMonthInput', () => {
  it('hai ô chọn Tháng và Năm, ghép thành yyyy-mm; chưa chọn đủ thì rỗng', async () => {
    const onChange = vi.fn();
    const r = render(<VnMonthInput value="" ariaLabel="Tháng xuất CSV" onChange={onChange} />);
    mounted.push(r);
    const month = r.container.querySelector<HTMLSelectElement>('select[aria-label="Tháng xuất CSV: tháng"]')!;
    expect(month.querySelector('option[value="10"]')!.textContent).toBe('Tháng 10');
    selectValue(month, '10');
    expect(onChange.mock.calls.at(-1)![0]).toMatch(/^\d{4}-10$/);
    selectValue(r.container.querySelector('select[aria-label="Tháng xuất CSV: năm"]'), '');
    expect(onChange.mock.calls.at(-1)![0]).toBe('');
  });

  it('giá trị có sẵn hiện đúng tháng và năm, kể cả năm ngoài dải mặc định', () => {
    const r = render(<VnMonthInput value="2015-03" onChange={() => undefined} />);
    mounted.push(r);
    const [m, y] = [...r.container.querySelectorAll('select')];
    expect((m as HTMLSelectElement).value).toBe('03');
    expect((y as HTMLSelectElement).value).toBe('2015');
  });
});
