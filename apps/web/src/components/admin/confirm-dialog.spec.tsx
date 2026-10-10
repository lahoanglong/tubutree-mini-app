// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { useConfirm, type ConfirmOptions } from './confirm-dialog';
import { answerConfirm, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';

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
    expect(accept.className).toContain('bg-red-600');
    expect(accept.className).toContain('min-h-[44px]');
    expect(cancel.className).toContain('min-h-[44px]');
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
