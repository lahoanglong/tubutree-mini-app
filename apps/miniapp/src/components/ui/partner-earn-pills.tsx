import { useNavigate } from 'zmp-ui';
import { haptic } from '../../utils/haptic';
import '../../css/ecosystem-hub.css';

const ITEMS = [
  { key: 'affiliate', to: '/affiliate', label: 'Tiếp thị liên kết (CTV)' },
  { key: 'dealer', to: '/dealer', label: 'Đại lý sỉ' },
] as const;

export function PartnerEarnPills({ active }: { active: 'affiliate' | 'dealer' }) {
  const navigate = useNavigate();
  return (
    <div className="tubu-partner-pills-wrap">
      <nav aria-label="Hợp tác cùng Tubu Tree" data-testid="partner-earn-pills" className="tubu-partner-pills">
        {ITEMS.map((item) => {
          const isCurrent = item.key === active;
          return (
            <a
              key={item.key}
              href={item.to}
              aria-current={isCurrent ? 'page' : undefined}
              className="tubu-partner-pill tubu-press"
              onClick={(e) => {
                e.preventDefault();
                if (isCurrent) return;
                haptic('light');
                navigate(item.to, { replace: true });
              }}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
