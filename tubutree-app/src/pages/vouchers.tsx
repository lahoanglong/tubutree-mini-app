// Vouchers — List voucher đang active, copy code
import React, { useEffect, useState } from "react";
import { Box, Text, Button, useSnackbar } from "zmp-ui";
import { voucherApi } from "services/api";
import type { Voucher } from "types";

const formatVnd = (s: string | number) => Number(s).toLocaleString() + " ₫";

const VouchersPage: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [items, setItems] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    voucherApi.listActive().then(setItems).finally(() => setLoading(false));
  }, []);

  const copy = (code: string) => {
    navigator.clipboard.writeText(code);
    openSnackbar({ text: `Đã copy mã ${code}`, type: "success" });
  };

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;

  return (
    <Box p={3}>
      <Text.Title>🎟️ Mã giảm giá</Text.Title>
      <Text size="small" style={{ color: "#666", marginBottom: 12 }}>
        Copy mã, dán vào ô "Mã giảm giá" khi thanh toán.
      </Text>

      {items.length === 0 && <Text style={{ color: "#999" }}>Hiện chưa có mã khuyến mãi nào.</Text>}

      {items.map(v => (
        <div key={v.id} style={{
          background: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
          borderLeft: "6px dashed #2E7D32",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 800, color: "#2E7D32" }}>{v.code}</div>
              <Text size="small">{v.description}</Text>
              <Text size="xSmall" style={{ color: "#666", marginTop: 4 }}>
                {v.type === "PERCENT"
                  ? <>Giảm <b>{v.value}%</b>{v.max_discount_vnd ? ` (tối đa ${formatVnd(v.max_discount_vnd)})` : ""}</>
                  : <>Giảm <b>{formatVnd(v.value)}</b></>}
                {" · "}Đơn từ {formatVnd(v.min_order_vnd)}
              </Text>
              <Text size="xSmall" style={{ color: "#999" }}>
                Hết hạn: {new Date(v.valid_to).toLocaleDateString()}
              </Text>
            </div>
            <Button size="small" onClick={() => copy(v.code)}>Copy</Button>
          </div>
        </div>
      ))}
    </Box>
  );
};

export default VouchersPage;
