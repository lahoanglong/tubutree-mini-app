import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { setStorage, getStorage } from 'zmp-sdk/apis';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Text } from '../components/ui/text';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { hasOA, followOA, requestNotifyPermission, getOaPromptState, setOaPromptState } from '../services/zmp-bridge';
import { applyFontScale } from '../utils/font-scale';
import { fetchNotifyPrefs, legacyOptOuts, saveNotifyPrefs, type NotifyPrefs } from './settings-notify-prefs';

const PREFS_KEY = 'tubu_prefs';

type FontScale = 'small' | 'normal' | 'large';
interface LocalPrefs {
  fontScale: FontScale;
}
/** Bản cũ còn lưu notifyPromo/notifyGarden trên máy; chỉ đọc để chuyển lên server một lần. */
type StoredPrefs = Partial<LocalPrefs & NotifyPrefs>;

const DEFAULT_LOCAL: LocalPrefs = { fontScale: 'normal' };

async function readStored(): Promise<StoredPrefs | null> {
  const res = await getStorage({ keys: [PREFS_KEY] });
  const raw = (res as Record<string, unknown>)[PREFS_KEY];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as StoredPrefs;
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  // useSnackbar của zmp-ui trả hàm mới mỗi lần render; đưa vào dep của effect sẽ lặp tải vô hạn.
  const openSnackbarRef = useRef(openSnackbar);
  openSnackbarRef.current = openSnackbar;
  const { logout } = useAuthStore();
  const [local, setLocal] = useState<LocalPrefs>(DEFAULT_LOCAL);
  const [notify, setNotify] = useState<NotifyPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await readStored().catch(() => null);
      const fontScale = stored?.fontScale ?? DEFAULT_LOCAL.fontScale;
      if (alive) setLocal({ fontScale });
      applyFontScale(fontScale);
      try {
        let server = await fetchNotifyPrefs();
        const patch = legacyOptOuts(stored, server);
        if (patch) server = await saveNotifyPrefs(patch);
        if (stored && ('notifyPromo' in stored || 'notifyGarden' in stored)) {
          void setStorage({ data: { [PREFS_KEY]: JSON.stringify({ fontScale }) } });
        }
        if (alive) setNotify(server);
      } catch {
        if (alive) openSnackbarRef.current({ type: 'error', text: 'Chưa tải được cài đặt thông báo. Thử lại sau nhé.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const updateFont = (fontScale: FontScale) => {
    setLocal({ fontScale });
    applyFontScale(fontScale);
    void setStorage({ data: { [PREFS_KEY]: JSON.stringify({ fontScale }) } });
    haptic('light');
  };

  // Khoá công tắc khi đang lưu: hai PATCH ngược chiều về lệch thứ tự sẽ làm màn hình khác server.
  const toggleNotify = async (key: keyof NotifyPrefs) => {
    if (!notify || saving) return;
    const before = notify;
    setSaving(true);
    setNotify({ ...before, [key]: !before[key] });
    haptic('light');
    try {
      setNotify(await saveNotifyPrefs({ [key]: !before[key] }));
    } catch {
      setNotify(before);
      openSnackbar({ type: 'error', text: 'Chưa lưu được cài đặt. Kiểm tra mạng rồi thử lại.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Cài đặt" />

      <Section title="Thông báo">
        {hasOA && <FollowOaRow />}
        <ListRow
          title="Cập nhật đơn hàng"
          subtitle="Luôn bật để bạn không lỡ tin giao hàng, hoàn tiền"
          style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
        />
        <Toggle
          label="Khuyến mãi & mã giảm giá"
          on={notify?.notifyPromo ?? false}
          disabled={!notify || saving}
          onToggle={() => void toggleNotify('notifyPromo')}
        />
        <Toggle
          label="Nhắc nhở Vườn Xanh & tương tác bài viết"
          on={notify?.notifyGarden ?? false}
          disabled={!notify || saving}
          onToggle={() => void toggleNotify('notifyGarden')}
          last
        />
      </Section>

      <Section title="Hiển thị · Cỡ chữ">
        <div role="radiogroup" aria-label="Cỡ chữ" style={{ display: 'flex', gap: 8 }}>
          {(['small', 'normal', 'large'] as const).map((s) => {
            const active = local.fontScale === s;
            return (
              <div
                key={s}
                role="radio"
                aria-checked={active}
                {...rowKeyboardProps()}
                className="tubu-press"
                onClick={() => updateFont(s)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  padding: '10px 0',
                  borderRadius: 'var(--radius-control)',
                  border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
                  background: active ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
                }}
              >
                <Text
                  as="div"
                  tone={active ? 'brand' : 'secondary'}
                  style={{ fontWeight: active ? 700 : 400, fontSize: s === 'small' ? 13 : s === 'large' ? 18 : 15 }}
                >
                  A
                </Text>
                <Text variant="caption" tone="tertiary" as="div">
                  {s === 'small' ? 'Nhỏ' : s === 'large' ? 'Lớn' : 'Vừa'}
                </Text>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Tài khoản">
        <LinkRow label="Chỉnh sửa hồ sơ" onClick={() => navigate('/edit-profile')} />
        <LinkRow label="Sổ địa chỉ" onClick={() => navigate('/addresses')} last />
      </Section>

      <div style={{ padding: 16 }}>
        <Button fullWidth variant="secondary" onPress={() => void logout()}>
          Đăng xuất
        </Button>
        <Text variant="caption" tone="tertiary" as="div" style={{ textAlign: 'center', marginTop: 12 }}>
          Tubu Tree · phiên bản 1.0.0
        </Text>
      </div>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '12px 16px 0' }}>
      <Card padding={16}>
        <Text as="h2" style={{ fontWeight: 700, marginBottom: 8 }}>
          {title}
        </Text>
        {children}
      </Card>
    </div>
  );
}

/** Cả hàng là công tắc (vùng chạm >= 44px), không chỉ viên thuốc 26px bên phải. */
function Toggle({
  label,
  on,
  onToggle,
  disabled,
  last,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const press = () => {
    if (!disabled) onToggle();
  };
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={0}
      className="tubu-press"
      onClick={press}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          press();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        padding: '8px 0',
        boxSizing: 'border-box',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)',
      }}
    >
      <Text variant="body-sm">{label}</Text>
      <span
        aria-hidden
        style={{
          width: 44,
          height: 26,
          flexShrink: 0,
          borderRadius: 'var(--radius-pill)',
          // Trạng thái tắt dùng border-strong: thanh trượt phải đạt 3:1 với nền thẻ (WCAG 1.4.11), border-subtle gần như tàng hình.
          background: on ? 'var(--color-action-primary-bg)' : 'var(--color-border-strong)',
          position: 'relative',
          transition: 'background var(--motion-enter)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--color-bg-surface)',
            boxShadow: 'var(--elevation-1)',
            transition: 'left var(--motion-enter)',
          }}
        />
      </span>
    </div>
  );
}

/**
 * Trạng thái theo dõi OA + nút (theo lại) — finding A3-01 nửa 2. `followed` chỉ là ghi nhớ cục bộ
 * (SDK không có API đọc lại trạng thái theo dõi thật của khách), nên chỉ hiển thị tham khảo.
 */
function FollowOaRow() {
  const [ready, setReady] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getOaPromptState().then((s) => {
      setFollowed(s.followed);
      setReady(true);
    });
  }, []);

  const handleFollow = async () => {
    setBusy(true);
    const ok = await followOA();
    if (ok) await requestNotifyPermission().catch(() => false);
    await setOaPromptState({ followed: ok, promptSeen: true });
    setFollowed(ok);
    setBusy(false);
    haptic(ok ? 'medium' : 'light');
  };

  if (!ready) return null; // tránh nháy sai trạng thái trước khi đọc xong cờ trên máy

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        padding: '8px 0',
        boxSizing: 'border-box',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <Text variant="body-sm">Theo dõi Zalo OA</Text>
      {followed ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon icon={Check} size="sm" tone="brand" />
          <Text variant="caption" tone="brand">
            Đã theo dõi
          </Text>
        </span>
      ) : (
        <Button loading={busy} onPress={() => void handleFollow()}>
          Theo dõi
        </Button>
      )}
    </div>
  );
}

function LinkRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <ListRow
      title={label}
      trailing="chevron"
      onPress={onClick}
      style={{ borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)' }}
    />
  );
}
