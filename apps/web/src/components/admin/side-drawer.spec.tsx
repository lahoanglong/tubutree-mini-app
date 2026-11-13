// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SideDrawer, useSideDrawerClose } from './side-drawer';
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
            onClick={async () => onReason(await ask({ title: 'Huỷ đơn', message: 'Nhập lý do', input: { label: 'Lý do', required: true } }))}
          >
            Huỷ đơn
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

// viewport-fit=cover: ngăn kéo dính mép màn hình nên tự chừa inset của tai thỏ ở đúng phía nó chạm (iPhone xoay ngang).
describe('SideDrawer safe-area', () => {
  const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

  it('ngăn kéo bên phải chừa inset phải, không đụng phía trái', () => {
    mount(<SideDrawer title="Đơn" onClose={() => undefined}>x</SideDrawer>);
    expect(panel().style.paddingRight).toBe('max(0px, env(safe-area-inset-right, 0px))');
    expect(panel().style.paddingLeft).toBe('');
  });

  it('ngăn kéo bên trái chừa inset trái, không đụng phía phải', () => {
    mount(<SideDrawer title="Đơn" side="left" onClose={() => undefined}>x</SideDrawer>);
    expect(panel().style.paddingLeft).toBe('max(0px, env(safe-area-inset-left, 0px))');
    expect(panel().style.paddingRight).toBe('');
  });
});

describe('SideDrawer chân dính và bề rộng theo phía', () => {
  const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

  it('footer nằm ngoài khung cuộn, dính đáy, chừa inset đáy; khung không chừa thêm lần nữa', () => {
    mount(
      <SideDrawer title="Sửa" onClose={() => undefined} footer={<button type="button">Lưu</button>}>
        <p>nội dung dài</p>
      </SideDrawer>,
    );
    const footer = document.querySelector<HTMLElement>('[data-drawer-footer]')!;
    expect(footer.textContent).toBe('Lưu');
    expect(footer.className).toContain('shrink-0');
    expect(footer.className).toContain('border-t');
    expect(footer.className).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]');
    const scroller = panel().querySelector<HTMLElement>('.overflow-y-auto')!;
    expect(scroller.contains(footer)).toBe(false);
    expect(scroller.textContent).toBe('nội dung dài');
    expect(panel().style.paddingBottom).toBe('0px');
  });

  it('không có footer thì không dựng vùng chân', () => {
    mount(<SideDrawer title="Sửa" onClose={() => undefined}>x</SideDrawer>);
    expect(document.querySelector('[data-drawer-footer]')).toBeNull();
  });

  it('ngăn trái hẹp (max-w-xs) và ngăn phải rộng (max-w-xl): không để hai max-w cùng một chuỗi lớp', () => {
    mount(<SideDrawer title="Menu" side="left" onClose={() => undefined}>x</SideDrawer>);
    expect(panel().className).toContain('max-w-xs');
    expect(panel().className).not.toContain('max-w-xl');
    mounted.pop()!.unmount();
    mount(<SideDrawer title="Đơn" onClose={() => undefined}>x</SideDrawer>);
    expect(panel().className).toContain('max-w-xl');
    expect(panel().className).not.toContain('max-w-xs');
  });
});

describe('SideDrawer dirty guard', () => {
  function Dirty({ dirty, onClose }: { dirty: boolean; onClose: () => void }) {
    return (
      <SideDrawer title="Sửa" dirty={dirty} onClose={onClose} footer={<InnerClose />}>
        <input aria-label="ô" />
      </SideDrawer>
    );
  }
  function InnerClose() {
    const close = useSideDrawerClose();
    return (
      <button type="button" data-testid="inner-close" onClick={close}>
        Đóng trong chân
      </button>
    );
  }

  it('chưa dirty: Esc, bấm nền, nút X, nút trong chân đều đóng ngay, không hỏi', () => {
    const onClose = vi.fn();
    mount(<Dirty dirty={false} onClose={onClose} />);
    key('Escape');
    click(document.querySelector('[data-drawer-backdrop]'));
    click(document.querySelector('button[aria-label="Đóng"]'));
    click(document.querySelector('[data-testid="inner-close"]'));
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(confirmDialog()).toBeNull();
  });

  it('dirty: mỗi đường đóng đều hỏi "Bỏ thay đổi chưa lưu?"; Tiếp tục sửa giữ ngăn, Bỏ thay đổi mới đóng', async () => {
    const onClose = vi.fn();
    mount(<Dirty dirty onClose={onClose} />);
    const routes: Array<() => void> = [
      () => void key('Escape'),
      () => click(document.querySelector('[data-drawer-backdrop]')),
      () => click(document.querySelector('button[aria-label="Đóng"]')),
      () => click(document.querySelector('[data-testid="inner-close"]')),
    ];
    for (const route of routes) {
      route();
      await flush(2);
      expect(confirmDialog()!.textContent).toContain('Bỏ thay đổi chưa lưu');
      answerConfirm(false);
      await flush(2);
      expect(onClose).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    }
    click(document.querySelector('button[aria-label="Đóng"]'));
    await flush(2);
    answerConfirm(true);
    await flush(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dirty cài cảnh báo rời trang (beforeunload); hết dirty hoặc đóng ngăn thì gỡ', () => {
    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    function Toggle() {
      const [dirty, setDirty] = useState(false);
      return (
        <>
          <button type="button" data-testid="toggle" onClick={() => setDirty((d) => !d)} />
          <Dirty dirty={dirty} onClose={() => undefined} />
        </>
      );
    }
    const r = mount(<Toggle />);
    const toggle = () => click(document.querySelector('[data-testid="toggle"]'));
    expect(fire()).toBe(false);
    toggle();
    expect(fire()).toBe(true);
    toggle();
    expect(fire()).toBe(false);
    toggle();
    expect(fire()).toBe(true);
    r.unmount();
    mounted.pop();
    expect(fire()).toBe(false);
  });
});
