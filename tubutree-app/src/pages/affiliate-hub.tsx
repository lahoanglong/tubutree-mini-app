// Affiliate Hub — Referral code, share link, stats, referrals, commissions
import React, { useEffect, useState } from "react";
import { Box, Text, Button, useSnackbar } from "zmp-ui";
import { affiliateHubApi, walletApi } from "services/api";
import type { AffiliateProfile, Referral, CommissionItem } from "types";

const COMMISSION_LABEL: Record<string, { text: string; color: string }> = {
  EARN: { text: "Hoa hồng", color: "#065f46" },
  REVERSE: { text: "Hoàn (huỷ đơn)", color: "#991b1b" },
  PAYOUT: { text: "Đã rút", color: "#7f1d1d" },
};

const formatVnd = (s: string) => Number(s).toLocaleString() + " ₫";

const AffiliateHubPage: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [profile, setProfile] = useState<AffiliateProfile | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissions, setCommissions] = useState<CommissionItem[]>([]);
  const [walletBal, setWalletBal] = useState<string>("0");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      affiliateHubApi.getProfile(),
      affiliateHubApi.getReferrals(1, 20),
      affiliateHubApi.getCommissions(1, 20),
      walletApi.getBalance(),
    ]).then(([p, r, c, w]) => {
      setProfile(p); setReferrals(r.data); setCommissions(c.data); setWalletBal(w.balance);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;
  if (!profile) return <Box p={4}><Text>Bạn chưa là CTV. Hãy đăng ký ở "Tài khoản → CTV/Đại lý".</Text></Box>;

  const shareLink = `https://zalo.me/s/565779011239360460/?ref=${profile.referral_code}`;

  const copyCode = () => {
    navigator.clipboard.writeText(profile.referral_code);
    openSnackbar({ text: "Đã copy mã giới thiệu", type: "success" });
  };
  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    openSnackbar({ text: "Đã copy link", type: "success" });
  };

  return (
    <Box p={3}>
      <Text.Title>🤝 Trang Cộng tác viên</Text.Title>

      {/* Wallet card */}
      <div style={{ background: "linear-gradient(135deg,#1e40af,#3b82f6)", borderRadius: 16, padding: 20, marginTop: 12, color: "#fff" }}>
        <Text size="small" style={{ color: "#dbeafe" }}>Số dư ví hoa hồng</Text>
        <div style={{ fontSize: 32, fontWeight: 800 }}>{formatVnd(walletBal)}</div>
        <Text size="xSmall" style={{ color: "#dbeafe" }}>
          Tổng hoa hồng đã nhận: {formatVnd(profile.total_commission)}
        </Text>
      </div>

      {/* Referral code */}
      <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginTop: 12 }}>
        <Text size="small" style={{ color: "#666" }}>Mã giới thiệu của bạn</Text>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ flex: 1, fontSize: 26, fontWeight: 800, letterSpacing: 2, color: "#2E7D32", fontFamily: "monospace" }}>
            {profile.referral_code}
          </div>
          <Button size="small" onClick={copyCode}>Copy</Button>
        </div>
        <Box mt={2}>
          <Text size="xSmall" style={{ color: "#666" }}>Link chia sẻ</Text>
          <div style={{ wordBreak: "break-all", fontSize: 12, padding: 8, background: "#f3f4f6", borderRadius: 6, marginTop: 4 }}>
            {shareLink}
          </div>
          <Button size="small" fullWidth onClick={copyLink} style={{ marginTop: 8 }}>📋 Copy link để share</Button>
        </Box>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <StatCard label="Khách giới thiệu" value={profile.total_referrals.toString()} />
        <StatCard label="Đơn đã có hoa hồng" value={profile.total_orders.toString()} />
      </div>

      {/* Referrals list */}
      <Box mt={3}>
        <Text bold style={{ marginBottom: 6 }}>Khách đã giới thiệu</Text>
        {referrals.length === 0 && <Text size="small" style={{ color: "#999" }}>Chưa có ai.</Text>}
        {referrals.map(r => (
          <div key={r.id} style={{ background: "#fff", padding: 10, borderRadius: 8, marginBottom: 6 }}>
            <Text size="small">User #{r.referred_user_id}</Text>
            <Text size="xSmall" style={{ color: "#666" }}>
              Bắt đầu: {new Date(r.created_at).toLocaleDateString()} · Hết hạn: {new Date(r.expires_at).toLocaleDateString()}
            </Text>
          </div>
        ))}
      </Box>

      {/* Commission history */}
      <Box mt={3}>
        <Text bold style={{ marginBottom: 6 }}>Lịch sử hoa hồng</Text>
        {commissions.length === 0 && <Text size="small" style={{ color: "#999" }}>Chưa có giao dịch.</Text>}
        {commissions.map(c => {
          const lab = COMMISSION_LABEL[c.type] || { text: c.type, color: "#444" };
          return (
            <div key={c.id} style={{ background: "#fff", padding: 10, borderRadius: 8, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <div>
                <Text size="small" bold>{lab.text}</Text>
                <Text size="xSmall" style={{ color: "#666" }}>{new Date(c.created_at).toLocaleString()}</Text>
                {c.note && <Text size="xSmall" style={{ color: "#999" }}>{c.note}</Text>}
              </div>
              <div style={{ color: Number(c.amount) > 0 ? "#065f46" : "#991b1b", fontWeight: 700 }}>
                {Number(c.amount) > 0 ? "+" : ""}{formatVnd(c.amount)}
              </div>
            </div>
          );
        })}
      </Box>
    </Box>
  );
};

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ background: "#fff", padding: 14, borderRadius: 10, textAlign: "center" }}>
    <Text size="xSmall" style={{ color: "#666" }}>{label}</Text>
    <div style={{ fontSize: 22, fontWeight: 800, color: "#2E7D32" }}>{value}</div>
  </div>
);

export default AffiliateHubPage;
