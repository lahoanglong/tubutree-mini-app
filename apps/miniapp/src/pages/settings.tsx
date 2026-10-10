import { useEffect, useState } from 'react';
import { Box, Page, Text, useNavigate, useSnackbar } from 'zmp-ui';
import { setStorage, getStorage } from 'zmp-sdk/apis';
import { Button } from '../components/ui/button';
import { ListRow } from '../components/ui/list-row';
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
  const { logout } = useAuthStore();
  const [local, setLocal] = useState<LocalPrefs>(DEFAULT_LOCAL);
  const [notify, setNotify] = useState<NotifyPrefs | null>(null);

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
        if (alive) openSnackbar({ type: 'error', text: 'Chưa tải được cài đặt thông báo. Thử lại sau nhé.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [openSnackbar]);

  const updateFont = (fontScale: FontScale) => {
    setLocal({ fontScale });
    applyFontScale(fontScale);
    void setStorage({ data: { [PREFS_KEY]: JSON.stringify({ fontScale }) } });
    haptic('light');
  };

  const toggleNotify = async (key: keyof NotifyPrefs) => {
    if (!notify) return;
    const before = notify;
    setNotify({ ...before, [key]: !before[key] });
    haptic('light');
    try {
      setNotify(await saveNotifyPrefs({ [key]: !before[key] }));
    } catch {
      setNotify(before);
      openSnackbar({ type: 'error', text: 'Chưa lưu được cài đặt. Kiểm tra mạng rồi thử lại.' });
    }
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      <Section title="Thông báo">
        {hasOA && <FollowOaRow />}
        <ListRow
          title="Cập nhật đơn hàng"
          subtitle="Luôn bật để bạn không lỡ tin giao hàng, hoàn tiền"
          style={{ borderBottom: '1px solid var(--neutral-100)' }}
        />
        <Toggle
          label="Khuyến mãi & mã giảm giá"
          on={notify?.notifyPromo ?? false}
          disabled={!notify}
          onToggle={() => void toggleNotify('notifyPromo')}
        />
        <Toggle
          label="Nhắc nhở Vườn Xanh"
          on={notify?.notifyGarden ?? false}
          disabled={!notify}
          onToggle={() => void toggleNotify('notifyGarden')}
          last
        />
      </Section>

      <Section title="Hiển thị · Cỡ chữ">
        <Box flex style={{ gap: 8 }}>
          {(['small', 'normal', 'large'] as const).map((s) => (
            <Box
              key={s}
              className="tubu-press"
              role="radio"
              aria-checked={local.fontScale === s}
              onClick={() => updateFont(s)}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '10px 0',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${local.fontScale === s ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
                background: local.fontScale === s ? 'var(--primary-50)' : 'var(--neutral-0)',
              }}
            >
              <Text
                bold={local.fontScale === s}
                style={{ color: local.fontScale === s ? 'var(--primary-700)' : 'var(--neutral-600)', fontSize: s === 'small' ? 13 : s === 'large' ? 18 : 15 }}
              >
                A
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {s === 'small' ? 'Nhỏ' : s === 'large' ? 'Lớn' : 'Vừa'}
              </Text>
            </Box>
          ))}
        </Box>
      </Section>

      <Section title="Tài khoản">
        <LinkRow label="Chỉnh sửa hồ sơ" onClick={() => navigate('/edit-profile')} />
        <LinkRow label="Sổ địa chỉ" onClick={() => navigate('/addresses')} />
        <LinkRow label="Beta Tester — trải nghiệm sớm" onClick={() => navigate('/beta')} last />
      </Section>

      <Box p={4}>
        <Button fullWidth variant="secondary" onPress={() => void logout()}>
          Đăng xuất
        </Button>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', textAlign: 'center', display: 'block', marginTop: 12 }}>
          Tubu Tree · phiên bản 1.0.0
        </Text>
      </Box>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box mx={4} mt={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Text bold style={{ marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </Box>
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
        borderBottom: last ? 'none' : '1px solid var(--neutral-100)',
      }}
    >
      <Text size="small">{label}</Text>
      <span
        aria-hidden
        style={{
          width: 44,
          height: 26,
          flexShrink: 0,
          borderRadius: 'var(--radius-full)',
          background: on ? 'var(--leaf-600)' : 'var(--neutral-200)',
          position: 'relative',
          transition: 'background var(--dur-base) var(--ease-out)',
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
            background: 'var(--neutral-0)',
            boxShadow: 'var(--shadow-sm)',
            transition: 'left var(--dur-base) var(--ease-out)',
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
    <Box
      flex
      alignItems="center"
      justifyContent="space-between"
      py={2}
      style={{ borderBottom: '1px solid var(--neutral-100)' }}
    >
      <Text size="small">Theo dõi Zalo OA</Text>
      {followed ? (
        <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
          Đã theo dõi ✓
        </Text>
      ) : (
        <Button loading={busy} onPress={() => void handleFollow()}>
          Theo dõi
        </Button>
      )}
    </Box>
  );
}

function LinkRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <ListRow
      title={label}
      trailing="chevron"
      onPress={onClick}
      style={{ borderBottom: last ? 'none' : '1px solid var(--neutral-100)' }}
    />
  );
}
