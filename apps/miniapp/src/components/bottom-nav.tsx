import { useNavigate, useLocation } from 'zmp-ui';

/**
 * Bottom tab bar tuỳ biến theo design M1 (§ TabBar): 5 tab, Vườn Xanh là nút TRÒN
 * NỔI ở giữa. Trang chủ · Danh mục · Vườn Xanh · Ví & HH · Cá nhân.
 * Icon line SVG sạch (không emoji). Active = xanh lá brand.
 */
const ACTIVE = 'var(--leaf-600)';
const IDLE = 'var(--neutral-400)';

function IcHome({ c }: { c: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5M5 9.5V20h5v-5h4v5h5V9.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IcGrid({ c }: { c: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke={c} strokeWidth="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke={c} strokeWidth="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke={c} strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" stroke={c} strokeWidth="1.8" />
    </svg>
  );
}
function IcWallet({ c }: { c: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2.5" stroke={c} strokeWidth="1.8" />
      <path d="M3 9h18" stroke={c} strokeWidth="1.8" />
      <circle cx="16.5" cy="13" r="1.3" fill={c} />
    </svg>
  );
}
function IcUser({ c }: { c: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.6" stroke={c} strokeWidth="1.8" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IcLeaf({ c }: { c: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 19c-1-9 6-15 15-15 1 10-6 15-15 15Z" fill={c} />
      <path d="M7 17C10 11 14 8 18 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

interface Tab {
  key: string;
  label: string;
  center?: boolean;
  Icon: (p: { c: string }) => JSX.Element;
}
const TABS: Tab[] = [
  { key: '/', label: 'Trang chủ', Icon: IcHome },
  { key: '/browse', label: 'Danh mục', Icon: IcGrid },
  { key: '/game', label: 'Vườn Xanh', center: true, Icon: IcLeaf },
  { key: '/wallet', label: 'Ví & HH', Icon: IcWallet },
  { key: '/profile', label: 'Cá nhân', Icon: IcUser },
];

const ROOTS = TABS.map((t) => t.key) as string[];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  if (!ROOTS.includes(path)) return null; // ẩn ở trang con

  return (
    <div
      style={{
        position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: 'calc(60px + var(--safe-bottom))',
          paddingBottom: 'var(--safe-bottom)',
          background: 'var(--neutral-0)',
          borderTop: '1px solid var(--neutral-100)',
          boxShadow: '0 -2px 12px rgba(92,52,10,0.06)',
          display: 'flex',
          alignItems: 'stretch',
          zIndex: 100,
        }}
      >
        {TABS.map((t) => {
          const active = path === t.key;
          const color = active ? ACTIVE : IDLE;
          if (t.center) {
            return (
              <div
                key={t.key}
                role="button"
                aria-label={t.label}
                className="tubu-press"
                onClick={() => navigate(t.key)}
                style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -22,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    background: 'var(--leaf-600)',
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: '0 4px 12px rgba(80,144,24,0.4)',
                    border: '3px solid var(--neutral-0)',
                  }}
                >
                  <t.Icon c="#fff" />
                </div>
                <span style={{ fontSize: 10.5, color, fontWeight: active ? 700 : 500 }}>
                  {t.label}
                </span>
              </div>
            );
          }
          return (
            <div
              key={t.key}
              role="button"
              aria-label={t.label}
              className="tubu-press"
              onClick={() => navigate(t.key)}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <t.Icon c={color} />
              <span style={{ fontSize: 10.5, color, fontWeight: active ? 700 : 500 }}>{t.label}</span>
            </div>
          );
        })}
      </div>
  );
}
