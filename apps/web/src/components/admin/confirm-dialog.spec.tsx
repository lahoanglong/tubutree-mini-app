// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { useConfirm, type ConfirmOptions } from './confirm-dialog';
import { answerConfirm, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

// Harness: một nút gọi confirm() rồi ghi kết quả ra DOM, như cách các panel admin dùng.
function Harness({ options, onResult }: { options: ConfirmOptions | string; onResult?: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  const [result, setResult] = useState('chưa hỏi');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm(options);
          setResult(ok ? 'đồng ý' : 'huỷ');
          onResult?.(ok);
        }}
      >
        hỏi
      </button>
      <output>{result}</output>
      {dialog}
    </div>
  );
}
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const ask = async (container: HTMLElement) => {
  click(container.querySelector('button'));
  await flush(1);
};

// C-122: admin web từng dùng window.confirm gốc của trình duyệt (không đồng bộ giao diện, không đổi được câu chữ/nút).
describe('useConfirm / ConfirmDialog', () => {
  it('lớp nền chừa inset trái/phải của tai thỏ, không nhỏ hơn lề 1rem sẵn có', async () => {
    const { container } = mount(<Harness options="Chắc chưa?" />);
    await ask(container);
    const backdrop = document.querySelector<HTMLElement>('[data-confirm-backdrop]')!;
    expect(backdrop.style.paddingLeft).toBe('max(1rem, env(safe-area-inset-left, 0px))');
    expect(backdrop.style.paddingRight).toBe('max(1rem, env(safe-area-inset-right, 0px))');
  });

  it('không bao giờ gọi window.confirm; chưa hỏi thì không có hộp thoại', async () => {
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<Harness options={{ title: 'Xác nhận', message: 'Chắc chưa?' }} />);
    expect(confirmDialog()).toBeNull();
    await ask(container);
    expect(confirmDialog()).not.toBeNull();
    expect(native).not.toHaveBeenCalled();
  });

  it('hiện tiêu đề + nội dung (giữ xuống dòng), nút mặc định "Xác nhận"/"Huỷ", đúng ARIA', async () => {
    const { container } = mount(<Harness options={{ title: 'Xác nhận đã trao', message: 'Dòng 1\n\nDòng 2' }} />);
    await ask(container);
    const d = confirmDialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    const labelledBy = d.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)?.textContent).toBe('Xác nhận đã trao');
    const describedBy = d.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('Dòng 1\n\nDòng 2');
    expect(document.getElementById(describedBy)?.className).toContain('whitespace-pre-line');
    expect(d.querySelector('[data-confirm="accept"]')?.textContent).toBe('Xác nhận');
    expect(d.querySelector('[data-confirm="cancel"]')?.textContent).toBe('Huỷ');
  });

  it('nhận chuỗi trơn thay cho options', async () => {
    const { container } = mount(<Harness options="Xoá thật không?" />);
    await ask(container);
    expect(confirmDialog()?.textContent).toContain('Xoá thật không?');
  });

  it('bấm Xác nhận → promise true, đóng hộp thoại', async () => {
    const { container } = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(container);
    answerConfirm(true);
    await flush(1);
    expect(container.querySelector('output')?.textContent).toBe('đồng ý');
    expect(confirmDialog()).toBeNull();
  });

  it('bấm Huỷ / Escape / bấm nền mờ → promise false', async () => {
    const { container } = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(container);
    answerConfirm(false);
    await flush(1);
    expect(container.querySelector('output')?.textContent).toBe('huỷ');
    expect(confirmDialog()).toBeNull();

    const r2 = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(r2.container);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush(1);
    expect(r2.container.querySelector('output')?.textContent).toBe('huỷ');
    expect(confirmDialog()).toBeNull();

    const r3 = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(r3.container);
    click(document.querySelector('[data-confirm-backdrop]'));
    await flush(1);
    expect(r3.container.querySelector('output')?.textContent).toBe('huỷ');
  });

  it('bấm vào thân hộp thoại không đóng; mặc định focus vào "Huỷ" (lối an toàn)', async () => {
    const { container } = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(container);
    click(confirmDialog());
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    expect(document.activeElement).toBe(confirmDialog()!.querySelector('[data-confirm="cancel"]'));
  });

  it('tông danger đổi màu nút xác nhận; nhãn tuỳ biến; hai nút cao tối thiểu 44px', async () => {
    const { container } = mount(
      <Harness options={{ title: 'Huỷ đơn', message: 'M', tone: 'danger', confirmLabel: 'Huỷ đơn', cancelLabel: 'Giữ đơn' }} />,
    );
    await ask(container);
    const accept = confirmDialog()!.querySelector('[data-confirm="accept"]')!;
    const cancel = confirmDialog()!.querySelector('[data-confirm="cancel"]')!;
    expect(accept.textContent).toBe('Huỷ đơn');
    expect(cancel.textContent).toBe('Giữ đơn');
    expect(accept.className).toContain('bg-danger-fg');
    expect(accept.className).toContain('min-h-[44px]');
    expect(cancel.className).toContain('min-h-[44px]');
  });

  it('tông mặc định: nút xác nhận xanh rừng (không phải màu nguy hiểm), cao tối thiểu 44px', async () => {
    const { container } = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(container);
    const accept = confirmDialog()!.querySelector('[data-confirm="accept"]')!;
    expect(accept.className).toContain('bg-forest-600');
    expect(accept.className).not.toContain('bg-danger-fg');
    expect(accept.className).toContain('min-h-[44px]');
  });

  it('hỏi lần hai khi lần một còn mở → lần một coi là huỷ, hộp thoại hiện câu mới', async () => {
    const results: boolean[] = [];
    function Twice() {
      const { confirm, dialog } = useConfirm();
      return (
        <div>
          <button type="button" onClick={() => void confirm({ title: 'Một', message: 'a' }).then((r) => results.push(r))}>
            1
          </button>
          <button type="button" onClick={() => void confirm({ title: 'Hai', message: 'b' }).then((r) => results.push(r))}>
            2
          </button>
          {dialog}
        </div>
      );
    }
    const { container } = mount(<Twice />);
    const [b1, b2] = Array.from(container.querySelectorAll('button'));
    click(b1!);
    click(b2!);
    await flush(1);
    expect(results).toEqual([false]);
    expect(confirmDialog()?.textContent).toContain('Hai');
    answerConfirm(true);
    await flush(1);
    expect(results).toEqual([false, true]);
  });

  it('gỡ component khi đang mở → promise treo được giải phóng bằng false, không rò rỉ', async () => {
    const onResult = vi.fn();
    const r = mount(<Harness options={{ title: 'T', message: 'M' }} onResult={onResult} />);
    await ask(r.container);
    r.unmount();
    mounted = mounted.filter((m) => m !== r);
    await flush(1);
    expect(onResult).toHaveBeenCalledWith(false);
    expect(confirmDialog()).toBeNull();
  });
});

// C-122 (review): window.prompt nhập lý do từ chối cũng phải đi qua hộp thoại DS, không còn hộp thoại gốc.
describe('useConfirm.ask — hộp thoại có ô nhập lý do', () => {
  function AskHarness({ options }: { options: ConfirmOptions }) {
    const { ask: askReason, dialog } = useConfirm();
    const [result, setResult] = useState('chưa hỏi');
    return (
      <div>
        <button type="button" onClick={async () => setResult(JSON.stringify(await askReason(options)))}>
          hỏi
        </button>
        <output>{result}</output>
        {dialog}
      </div>
    );
  }
  const REASON = { label: 'Lý do từ chối', placeholder: 'Khách sẽ không nhận tiền', maxLength: 200 };

  it('hiện ô nhập có nhãn + giới hạn ký tự, focus vào ô nhập; không gọi window.prompt', async () => {
    const native = vi.spyOn(window, 'prompt');
    const { container } = mount(<AskHarness options={{ title: 'Từ chối', message: 'M', input: REASON }} />);
    await ask(container);
    const box = confirmDialog()!.querySelector('textarea')!;
    expect(box.getAttribute('maxlength')).toBe('200');
    expect(box.getAttribute('placeholder')).toBe('Khách sẽ không nhận tiền');
    expect(confirmDialog()!.textContent).toContain('Lý do từ chối');
    expect(document.activeElement).toBe(box);
    expect(native).not.toHaveBeenCalled();
  });

  it('Xác nhận → trả về lý do đã gõ (cắt khoảng trắng đầu/cuối); Huỷ → null', async () => {
    const { container } = mount(<AskHarness options={{ title: 'Từ chối', message: 'M', input: REASON }} />);
    await ask(container);
    typeInto(confirmDialog()!.querySelector('textarea'), '  Sai mã đơn  ');
    answerConfirm(true);
    await flush(1);
    expect(container.querySelector('output')?.textContent).toBe('"Sai mã đơn"');
    expect(confirmDialog()).toBeNull();

    await ask(container);
    typeInto(confirmDialog()!.querySelector('textarea'), 'gõ rồi huỷ');
    answerConfirm(false);
    await flush(1);
    expect(container.querySelector('output')?.textContent).toBe('null');
  });

  it('để trống mà vẫn xác nhận được khi lý do không bắt buộc → chuỗi rỗng (khác null của Huỷ)', async () => {
    const { container } = mount(<AskHarness options={{ title: 'T', message: 'M', input: REASON }} />);
    await ask(container);
    answerConfirm(true);
    await flush(1);
    expect(container.querySelector('output')?.textContent).toBe('""');
  });

  it('lý do bắt buộc: nút Xác nhận bị khoá tới khi có chữ', async () => {
    const { container } = mount(<AskHarness options={{ title: 'T', message: 'M', input: { ...REASON, required: true } }} />);
    await ask(container);
    const accept = confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
    expect(accept.disabled).toBe(true);
    typeInto(confirmDialog()!.querySelector('textarea'), '   ');
    expect(accept.disabled).toBe(true);
    typeInto(confirmDialog()!.querySelector('textarea'), 'Có lý do');
    expect(accept.disabled).toBe(false);
  });

  it('confirm() thường không có ô nhập', async () => {
    const { container } = mount(<Harness options={{ title: 'T', message: 'M' }} />);
    await ask(container);
    expect(confirmDialog()!.querySelector('textarea')).toBeNull();
  });
});
