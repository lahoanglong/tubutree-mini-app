import { useEffect, useState } from 'react';
import { Box, Page, Text, Button, useNavigate } from 'zmp-ui';
import { setStorage, getStorage } from 'zmp-sdk/apis';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { hasOA, followOA, requestNotifyPermission, getOaPromptState, setOaPromptState } from '../services/zmp-bridge';

const PREFS_KEY = 'tubu_prefs';

interface Prefs {
  notifyOrders: boolean;
  notifyPromo: boolean;
  notifyGarden: boolean;
  fontScale: 'small' | 'normal' | 'large';
}
const DEFAULT_PREFS: Prefs = {
  notifyOrders: true,
  notifyPromo: true,
  notifyGarden: true,
  fontScale: 'normal',
};
import { applyFontScale } from '../utils/font-scale';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    void getStorage({ keys: [PREFS_KEY] }).then((res) => {
      const raw = (res as Record<string, unknown>)[PREFS_KEY];
      if (typeof raw === 'string') {
        try {
          const p = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
          setPrefs(p);
          applyFontScale(p.fontScale);
        } catch {
          /* ignore */
        }
      }
    });
  }, []);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (patch.fontScale) applyFontScale(patch.fontScale);
    void setStorage({ data: { [PREFS_KEY]: JSON.stringify(next) } });
    haptic('light');
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      <Section title="Thông báo">
        {hasOA && <FollowOaRow />}
        <Toggle label="Cập nhật đơn hàng" on={prefs.notifyOrders} onToggle={() => update({ notifyOrders: !prefs.notifyOrders })} />
        <Toggle label="Khuyến mãi & voucher" on={prefs.notifyPromo} onToggle={() => update({ notifyPromo: !prefs.notifyPromo })} />
        <Toggle label="Nhắc nhở Vườn Xanh" on={prefs.notifyGarden} onToggle={() => update({ notifyGarden: !prefs.notifyGarden })} last />
      </Section>

      <Section title="Hiển thị · Cỡ chữ">
        <Box flex style={{ gap: 8 }}>
          {(['small', 'normal', 'large'] as const).map((s) => (
            <Box
              key={s}
              className="tubu-press"
              onClick={() => update({ fontScale: s })}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '10px 0',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${prefs.fontScale === s ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
                background: prefs.fontScale === s ? 'var(--primary-50)' : 'var(--neutral-0)',
              }}
            >
              <Text
                bold={prefs.fontScale === s}
                style={{ color: prefs.fontScale === s ? 'var(--primary-700)' : 'var(--neutral-600)', fontSize: s === 'small' ? 13 : s === 'large' ? 18 : 15 }}
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
        <Button fullWidth variant="secondary" onClick={() => void logout()}>
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

function Toggle({ label, on, onToggle, last }: { label: string; on: boolean; onToggle: () => void; last?: boolean }) {
  return (
    <Box
      flex
      alignItems="center"
      justifyContent="space-between"
      py={2}
      style={{ borderBottom: last ? 'none' : '1px solid var(--neutral-100)' }}
    >
      <Text size="small">{label}</Text>
      <Box
        role="switch"
        aria-checked={on}
        className="tubu-press"
        onClick={onToggle}
        style={{
          width: 44,
          height: 26,
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
      </Box>
    </Box>
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
        <Button size="small" loading={busy} disabled={busy} onClick={() => void handleFollow()} style={{ background: 'var(--leaf-600)' }}>
          Theo dõi
        </Button>
      )}
    </Box>
  );
}

function LinkRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <Box
      className="tubu-press"
      flex
      alignItems="center"
      justifyContent="space-between"
      py={3}
      onClick={onClick}
      style={{ borderBottom: last ? 'none' : '1px solid var(--neutral-100)' }}
    >
      <Text size="small">{label}</Text>
      <Text style={{ color: 'var(--neutral-400)' }}>›</Text>
    </Box>
  );
}
