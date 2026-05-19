// Agent Hub — Hồ sơ đại lý + công cụ tính giá sỉ
import React, { useEffect, useState } from "react";
import { Box, Text, Input, Button } from "zmp-ui";
import { agentPricingApi } from "services/api";
import type { AgentProfileInfo } from "types";

const formatVnd = (s: string | number) => Number(s).toLocaleString() + " ₫";

const AgentHubPage: React.FC = () => {
  const [profile, setProfile] = useState<AgentProfileInfo | null>(null);
  const [retail, setRetail] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentPricingApi.getMyProfile().then(setProfile).finally(() => setLoading(false));
  }, []);

  const doPreview = async () => {
    const n = Number(retail);
    if (!n) return;
    const r = await agentPricingApi.previewWholesale(n);
    setPreview(r.wholesale);
  };

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;
  if (!profile) return <Box p={4}><Text>Bạn chưa là Đại lý.</Text></Box>;

  const tierColors: Record<string, string> = {
    BRONZE: "#92400e", SILVER: "#475569", GOLD: "#a16207",
  };

  return (
    <Box p={3}>
      <Text.Title>🏪 Trang Đại lý</Text.Title>

      <div style={{
        background: "#fff", borderRadius: 16, padding: 20, marginTop: 12,
        borderLeft: `6px solid ${tierColors[profile.tier_code] || "#2E7D32"}`,
      }}>
        <Text size="small" style={{ color: "#666" }}>Hạng đại lý của bạn</Text>
        <div style={{ fontSize: 28, fontWeight: 800, color: tierColors[profile.tier_code] || "#2E7D32" }}>
          {profile.tier_name}
        </div>
        <Text size="xSmall" style={{ color: "#666" }}>
          Giảm <b>{profile.discount_pct}%</b> trên giá lẻ · Đơn tối thiểu {formatVnd(profile.min_order_vnd)}
        </Text>
      </div>

      <Box mt={3}>
        <Text bold style={{ marginBottom: 6 }}>Tính giá sỉ nhanh</Text>
        <Input
          label="Nhập giá lẻ (VND)"
          value={retail}
          onChange={e => setRetail(e.target.value.replace(/\D/g, ""))}
          placeholder="100000"
        />
        <Button size="small" fullWidth onClick={doPreview} style={{ marginTop: 8 }}>
          Tính
        </Button>
        {preview != null && (
          <div style={{ marginTop: 12, background: "#f0fdf4", padding: 12, borderRadius: 10 }}>
            <Text size="small">Giá sỉ cho bạn:</Text>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>{formatVnd(preview)}</div>
            <Text size="xSmall" style={{ color: "#166534" }}>
              Tiết kiệm {formatVnd(Number(retail) - Number(preview))} so với giá lẻ
            </Text>
          </div>
        )}
      </Box>

      <Box mt={4}>
        <Text size="xSmall" style={{ color: "#999" }}>
          💡 Đặt đơn ở giá sỉ qua app hoặc liên hệ admin. Để nâng hạng, liên hệ admin.
        </Text>
      </Box>
    </Box>
  );
};

export default AgentHubPage;
