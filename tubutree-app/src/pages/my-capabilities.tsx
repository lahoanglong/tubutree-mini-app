// My Capabilities — Trạng thái CTV / Đại lý / Admin
import React, { useEffect, useState } from "react";
import { Box, Text, Button } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { meApi } from "services/api";
import { attributePendingRef } from "utils/referral";
import type { MyCapabilities } from "types";

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  PENDING:   { text: "Đang chờ duyệt", color: "#92400e", bg: "#fef3c7" },
  APPROVED:  { text: "Đã duyệt",        color: "#065f46", bg: "#d1fae5" },
  REJECTED:  { text: "Bị từ chối",      color: "#991b1b", bg: "#fee2e2" },
  SUSPENDED: { text: "Tạm ngưng",       color: "#7f1d1d", bg: "#fecaca" },
};

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  if (!status) return null;
  const s = STATUS_LABEL[status] || { text: status, color: "#444", bg: "#eee" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 12,
      fontSize: 12, fontWeight: 600, color: s.color, background: s.bg,
    }}>{s.text}</span>
  );
};

const CapabilityCard: React.FC<{
  title: string; description: string; icon: string;
  enabled: boolean; status?: string; rejectReason?: string | null;
  ctaText: string; onClick: () => void;
}> = ({ title, description, icon, enabled, status, rejectReason, ctaText, onClick }) => (
  <div style={{
    background: "#fff", borderRadius: 14, padding: 16, marginBottom: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <Text size="large" bold>{icon} {title}</Text>
      {enabled && <StatusBadge status="APPROVED" />}
      {!enabled && status && <StatusBadge status={status} />}
    </div>
    <Text size="small" style={{ color: "#666", marginBottom: 10 }}>{description}</Text>
    {rejectReason && (
      <div style={{ background: "#fef2f2", padding: 8, borderRadius: 8, marginBottom: 10 }}>
        <Text size="xSmall" style={{ color: "#991b1b" }}>Lý do từ chối: {rejectReason}</Text>
      </div>
    )}
    <Button size="small" onClick={onClick} fullWidth>{ctaText}</Button>
  </div>
);

const MyCapabilitiesPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<MyCapabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Best-effort: gán referrer nếu user đã mở app qua link ref
    attributePendingRef().catch(() => {});
    meApi.getCapabilities().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;
  if (!data) return <Box p={4}><Text>Không tải được dữ liệu. Vui lòng đăng nhập lại.</Text></Box>;

  const aff = data.affiliate_application;
  const agt = data.agent_application;
  const u = data.user;

  // Affiliate
  let affCta = "Đăng ký Cộng tác viên";
  let affAction = () => navigate("/become-affiliate");
  if (aff?.status === "PENDING") { affCta = "Xem đơn đang chờ"; }
  else if (u.affiliate_enabled) { affCta = "Mở trang CTV"; affAction = () => navigate("/affiliate-hub"); }
  else if (aff?.status === "REJECTED") { affCta = "Nộp lại đơn"; }
  else if (aff?.status === "SUSPENDED") { affCta = "Liên hệ admin"; affAction = () => {}; }

  // Agent
  let agtCta = "Đăng ký Đại lý";
  let agtAction = () => navigate("/become-agent");
  if (agt?.status === "PENDING") agtCta = "Xem đơn đang chờ";
  else if (u.agent_enabled) { agtCta = "Mở trang Đại lý"; agtAction = () => navigate("/agent-hub"); }
  else if (agt?.status === "REJECTED") agtCta = "Nộp lại đơn";
  else if (agt?.status === "SUSPENDED") { agtCta = "Liên hệ admin"; agtAction = () => {}; }

  return (
    <Box p={3}>
      <Text.Title style={{ marginBottom: 12 }}>Tài khoản nâng cao</Text.Title>

      <CapabilityCard
        title="Cộng tác viên"
        description="Chia sẻ link sản phẩm, nhận hoa hồng khi có khách đặt qua link của bạn."
        icon="🤝"
        enabled={u.affiliate_enabled}
        status={aff?.status}
        rejectReason={aff?.reject_reason}
        ctaText={affCta}
        onClick={affAction}
      />

      <CapabilityCard
        title="Đại lý"
        description="Nhập hàng giá sỉ, có thể quản lý danh sách CTV cấp dưới."
        icon="🏪"
        enabled={u.agent_enabled}
        status={agt?.status}
        rejectReason={agt?.reject_reason}
        ctaText={agtCta}
        onClick={agtAction}
      />

      {u.is_admin && (
        <div style={{ background: "#1e293b", color: "#fff", borderRadius: 14, padding: 16, marginTop: 8 }}>
          <Text size="large" bold style={{ color: "#fff" }}>⚙️ Bạn là Admin</Text>
          <Text size="small" style={{ color: "#cbd5e1", marginTop: 4, marginBottom: 12 }}>
            Quản lý đơn đăng ký CTV / Đại lý, ban user.
          </Text>
          <Button size="small" variant="secondary" onClick={() => navigate("/admin")}>
            Vào trang Admin
          </Button>
        </div>
      )}
    </Box>
  );
};

export default MyCapabilitiesPage;
