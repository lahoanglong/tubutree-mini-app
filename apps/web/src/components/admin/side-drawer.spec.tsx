// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SideDrawer } from './side-drawer';
import { useConfirm } from './confirm-dialog';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(e);
  });
  return e;
};

// Như panel admin hủy đơn trong ngăn kéo chi tiết đơn: nút mở hộp xác nhận có ô nhập lý do.
function Host({ onClose, onReason }: { onClose: () => void; onReason: (r: string | null) => void }) {
  const { ask, dialog } = useConfirm();
  const [open, setOpen] = useState(true);
  return (
    <div>
      {open && (
        <SideDrawer
          title="Đơn TT1"
          onClose={() => {
            setOpen(false);
            onClose();
          }}
        >
          <button
            id="cancel"
            type="button"
            onClick={async () => onReason(await ask({ title: 'Hủy đơn', message: 'Nhập lý do', input: { label: 'Lý do', required: true } }))}
          >
            Hủy đơn
          </button>
          <button id="other" type="button">
            Khác
          </button>
        </SideDrawer>
      )}
      {dialog}
    </div>
  );
}

const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

describe('SideDrawer a11y (WEB-11)', () => {
  it('Esc trong hộp xác nhận mở từ ngăn kéo chỉ đóng hộp xác nhận, ngăn kéo còn nguyên; Esc lần hai mới đóng ngăn kéo', async () => {
    const onClose = vi.fn();
    const onReason = vi.fn();
    mount(<Host onClose={onClose} onReason={onReason} />);
    click(document.getElementById('cancel'));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Khách đổi ý');
    key('Escape');
    await flush(1);
    expect(confirmDialog()).toBeNull();
    expect(onReason).toHaveBeenCalledWith(null);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    key('Escape');
    await flush(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab trong hộp xác nhận không bị ngăn kéo kéo focus về nút của ngăn kéo', async () => {
    mount(<Host onClose={() => undefined} onReason={() => undefined} />);
    click(document.getElementById('cancel'));
    await flush(1);
    const d = confirmDialog()!;
    expect(d.contains(document.activeElement)).toBe(true);
    key('Tab');
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('Tab/Shift+Tab quay vòng trong ngăn kéo (nút Đóng, các nút trong nội dung)', () => {
    mount(<Host onClose={() => undefined} onReason={() => undefined} />);
    const drawer = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(drawer);
    document.getElementById('other')!.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(drawer.querySelector('button[aria-label="Đóng"]'));
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('other'));
  });

  it('đóng ngăn kéo mở lại cuộn nền', async () => {
    mount(<Host onClose={() => undefined} onReason={() => undefined} />);
    expect(document.body.style.overflow).toBe('hidden');
    click(document.querySelector('button[aria-label="Đóng"]'));
    await flush(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
