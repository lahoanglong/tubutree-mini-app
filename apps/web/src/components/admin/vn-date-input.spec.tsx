// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act } from 'react';
import { byText, click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { VnDateInput, VnDateTimeInput, VnMonthInput, isoToVn, maskVnDate, vnToIso } from './vn-date-input';

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

  it('onPendingChange báo true khi đang gõ dở hoặc ngày không có thật, false khi đủ ngày hợp lệ hoặc rỗng; dòng nhắc nói đúng lý do', async () => {
    const onPending = vi.fn();
    function H() {
      const [v, setV] = useState('2026-12-31');
      return <VnDateInput value={v} ariaLabel="Từ ngày" onChange={setV} onPendingChange={onPending} />;
    }
    const r = render(<H />);
    mounted.push(r);
    await flush();
    expect(onPending).toHaveBeenLastCalledWith(false);
    typeInto(field(r.container), '15/11/202');
    await flush();
    expect(onPending).toHaveBeenLastCalledWith(true);
    expect(r.container.textContent).toContain('Chưa áp dụng, gõ đủ ngày');
    typeInto(field(r.container), '31/02/2026');
    await flush();
    expect(onPending).toHaveBeenLastCalledWith(true);
    expect(r.container.textContent).toContain('Ngày không có thật');
    typeInto(field(r.container), '15/11/2026');
    await flush();
    expect(onPending).toHaveBeenLastCalledWith(false);
    typeInto(field(r.container), '');
    await flush();
    expect(onPending).toHaveBeenLastCalledWith(false);
  });

  it('sau khi rời ô, ngày đủ dạng mà không có thật vẫn báo "Ngày không có thật", không bảo sai dạng', async () => {
    const r = render(<VnDateInput value="" ariaLabel="Từ ngày" onChange={() => {}} />);
    mounted.push(r);
    typeInto(field(r.container), '31/02/2026');
    act(() => field(r.container).dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(r.container.textContent).toContain('Ngày không có thật');
    expect(r.container.textContent).not.toContain('Nhập ngày dạng dd/mm/yyyy');
    typeInto(field(r.container), '15/1');
    await flush();
    expect(r.container.textContent).toContain('Nhập ngày dạng dd/mm/yyyy');
  });

  it('gõ lần hai sau khi đã rời ô thì không báo đỏ khi đang gõ dở; rời ô lần nữa mới báo', async () => {
    const r = render(<VnDateInput value="" ariaLabel="Từ ngày" onChange={() => {}} />);
    mounted.push(r);
    typeInto(field(r.container), '15/1');
    act(() => field(r.container).dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(field(r.container).getAttribute('aria-invalid')).toBe('true');
    act(() => field(r.container).dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    typeInto(field(r.container), '15/11/20');
    await flush();
    expect(field(r.container).getAttribute('aria-invalid')).toBeNull();
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    act(() => field(r.container).dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(field(r.container).getAttribute('aria-invalid')).toBe('true');
  });

  it('dòng nhắc nằm trong luồng (không absolute) để không che nút bên dưới', async () => {
    const r = render(<VnDateInput value="" ariaLabel="Từ ngày" onChange={() => {}} />);
    mounted.push(r);
    typeInto(field(r.container), '15/1');
    await flush();
    const hint = r.container.querySelector('[role="status"]')!;
    expect(hint.textContent).toContain('Chưa áp dụng');
    expect(hint.className).not.toMatch(/\babsolute\b/);
    act(() => field(r.container).dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.className).not.toMatch(/\babsolute\b/);
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

describe('VnDateTimeInput', () => {
  function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
    const [v, setV] = useState(initial);
    return <VnDateTimeInput value={v} ariaLabel="Bắt đầu" onChange={(x) => { setV(x); onValue?.(x); }} />;
  }
  const hour = (c: HTMLElement) => c.querySelector<HTMLSelectElement>('select[aria-label="Bắt đầu: giờ"]')!;
  const minute = (c: HTMLElement) => c.querySelector<HTMLSelectElement>('select[aria-label="Bắt đầu: phút"]')!;
  const date = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Bắt đầu: ngày"]')!;

  it('giờ 24h 00-23, phút 00/15/30/45; không có ô gốc của trình duyệt', () => {
    const r = render(<Harness initial="2026-10-28T20:00" />);
    mounted.push(r);
    expect([...hour(r.container).options].map((o) => o.value)).toEqual(['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23']);
    expect([...minute(r.container).options].map((o) => o.value)).toEqual(['00', '15', '30', '45']);
    expect(hour(r.container).value).toBe('20');
    expect(minute(r.container).value).toBe('00');
    expect(date(r.container).value).toBe('28/10/2026');
    expect(r.container.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it('giá trị cũ 20:07 vẫn hiện đúng phút 07 và giữ khi đổi giờ', () => {
    const onValue = vi.fn();
    const r = render(<Harness initial="2026-10-28T20:07" onValue={onValue} />);
    mounted.push(r);
    expect(minute(r.container).value).toBe('07');
    expect([...minute(r.container).options].map((o) => o.value)).toEqual(['00', '07', '15', '30', '45']);
    selectValue(hour(r.container), '21');
    expect(onValue).toHaveBeenLastCalledWith('2026-10-28T21:07');
  });

  it('gõ ngày rồi chọn giờ ra yyyy-mm-ddTHH:mm; chọn giờ trước ngày thì giữ giờ chờ ngày; xoá ngày thì rỗng', async () => {
    const onValue = vi.fn();
    const r = render(<Harness onValue={onValue} />);
    mounted.push(r);
    selectValue(hour(r.container), '20');
    expect(onValue).not.toHaveBeenCalled();
    typeInto(date(r.container), '28102026');
    await flush();
    expect(onValue).toHaveBeenLastCalledWith('2026-10-28T20:00');
    selectValue(minute(r.container), '45');
    expect(onValue).toHaveBeenLastCalledWith('2026-10-28T20:45');
    typeInto(date(r.container), '');
    await flush();
    expect(onValue).toHaveBeenLastCalledWith('');
  });

  it('sửa giá trị có sẵn 20:07: xoá ngày rồi gõ ngày mới thì vẫn giữ giờ 20:07, không rơi về 00:00', async () => {
    const onValue = vi.fn();
    const r = render(<Harness initial="2026-10-20T20:07" onValue={onValue} />);
    mounted.push(r);
    typeInto(date(r.container), '');
    await flush();
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(hour(r.container).value).toBe('20');
    expect(minute(r.container).value).toBe('07');
    typeInto(date(r.container), '21102026');
    await flush();
    expect(onValue).toHaveBeenLastCalledWith('2026-10-21T20:07');
  });

  it('cha đặt giá trị mới thì giờ chờ theo giá trị đó', async () => {
    const onValue = vi.fn();
    function Parent() {
      const [v, setV] = useState('2026-10-20T20:07');
      return (
        <>
          <button type="button" onClick={() => setV('2026-10-22T08:30')}>đổi</button>
          <button type="button" onClick={() => setV('')}>xoá</button>
          <VnDateTimeInput value={v} ariaLabel="Bắt đầu" onChange={(x) => { setV(x); onValue(x); }} />
        </>
      );
    }
    const r = render(<Parent />);
    mounted.push(r);
    click(byText(r.container, 'button', 'đổi'));
    await flush();
    click(byText(r.container, 'button', 'xoá'));
    await flush();
    typeInto(date(r.container), '23102026');
    await flush();
    expect(onValue).toHaveBeenLastCalledWith('2026-10-23T08:30');
  });
});
