// Checkout Page — Xác nhận đơn hàng (voucher + points + breakdown)
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Input, Spinner, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { cartItemsState } from "state/cart";
import { addressApi, orderApi, productApi, voucherApi, pointsApi } from "services/api";
import type { Address, Product, PointsBalance, VoucherApplyResult } from "types";

const formatVnd = (n: number | bigint | string) => Number(n).toLocaleString() + " ₫";

const CheckoutPage: React.FC = () => {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const cartItems = useRecoilValue(cartItemsState);
  const setCart = useSetRecoilState(cartItemsState);

  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Pricing
  const [productMap, setProductMap] = useState<Record<string, Product>>({});
  const [subtotal, setSubtotal] = useState(0);

  // Voucher
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherApplied, setVoucherApplied] = useState<VoucherApplyResult | null>(null);
  const [voucherChecking, setVoucherChecking] = useState(false);

  // Points
  const [pointsBalance, setPointsBalance] = useState<PointsBalance | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState("");
  const [pointsDiscount, setPointsDiscount] = useState(0);
  const [pointsError, setPointsError] = useState<string | null>(null);

  useEffect(() => {
    loadInit();
  }, []);

  const loadInit = async () => {
    try {
      const [addrs, balance, products] = await Promise.all([
        addressApi.getAll().catch(() => []),
        pointsApi.getBalance().catch(() => null),
        Promise.all(
          [...new Set(cartItems.map(i => i.pos_product_id))].map(id =>
            productApi.getDetail(id).then(p => [id, p] as const).catch(() => null),
          ),
        ),
      ]);
      const defaultAddr = addrs.find(a => a.is_default) || addrs[0];
      if (defaultAddr) setSelectedAddress(defaultAddr);
      if (balance) setPointsBalance(balance);

      const map: Record<string, Product> = {};
      products.forEach(p => { if (p) map[p[0]] = p[1]; });
      setProductMap(map);

      // Compute subtotal
      let total = 0;
      for (const item of cartItems) {
        const prod = map[item.pos_product_id];
        if (!prod) continue;
        const variation = item.variant_id
          ? prod.variations.find(v => v.id === item.variant_id)
          : prod.variations[0];
        if (variation) total += Number(variation.retail_price) * item.qty;
      }
      setSubtotal(total);
    } finally {
      setLoading(false);
    }
  };

  // Recompute points discount with 250ms debounce — tránh fire API mỗi keystroke
  useEffect(() => {
    const n = Number(pointsToRedeem);
    if (!n || !subtotal) {
      setPointsError(null);
      setPointsDiscount(0);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      pointsApi.previewRedeem(n, subtotal).then(r => {
        if (cancelled) return;
        if (r.valid) {
          setPointsDiscount(Number(r.discount_vnd));
          setPointsError(null);
        } else {
          setPointsDiscount(0);
          setPointsError(r.error);
        }
      }).catch(() => { if (!cancelled) setPointsError(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pointsToRedeem, subtotal]);

  const checkVoucher = async () => {
    if (!voucherCode.trim()) return;
    setVoucherChecking(true);
    try {
      const r = await voucherApi.apply(voucherCode.trim().toUpperCase(), subtotal);
      setVoucherApplied(r);
      if (!r.valid) openSnackbar({ text: r.error || "Mã không hợp lệ", type: "error" });
      else openSnackbar({ text: `Giảm ${formatVnd(r.discount_vnd || "0")}`, type: "success" });
    } catch (e: any) {
      openSnackbar({ text: e.response?.data?.error || e.message, type: "error" });
    } finally {
      setVoucherChecking(false);
    }
  };

  const clearVoucher = () => { setVoucherCode(""); setVoucherApplied(null); };

  const voucherDiscount = voucherApplied?.valid ? Number(voucherApplied.discount_vnd) : 0;
  const totalDiscount = Math.min(voucherDiscount + pointsDiscount, subtotal);
  const finalTotal = subtotal - totalDiscount;

  const handleOrder = async () => {
    if (!selectedAddress) {
      openSnackbar({ text: "Vui lòng chọn địa chỉ giao hàng", type: "error" });
      return;
    }
    if (subtotal <= 0) {
      openSnackbar({ text: "Không xác định được tổng tiền — refresh giỏ hàng", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const items = cartItems.map(item => ({
        pos_product_id: item.pos_product_id,
        variant_id: item.variant_id,
        qty: item.qty,
      }));

      await orderApi.create({
        items,
        addressId: selectedAddress.id,
        paymentMethod,
        notes,
        subtotal_vnd: subtotal,
        voucher_code: voucherApplied?.valid ? voucherApplied.code : undefined,
        points_to_redeem: Number(pointsToRedeem) || 0,
      } as any);

      setCart([]);
      openSnackbar({ text: "🎉 Đặt hàng thành công!", type: "success" });
      navigate("/orders");
    } catch (err: any) {
      openSnackbar({ text: err.response?.data?.error || "Đặt hàng thất bại", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60 }}><Spinner visible /></Box>;
  }

  const paymentOptions = [
    { value: "COD", label: "💵 Thanh toán khi nhận hàng (COD)" },
    { value: "VIETQR", label: "🏦 Chuyển khoản ngân hàng (VietQR)" },
  ];

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Xác nhận đơn hàng</span>
      </div>

      {/* Address */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>📍 Địa chỉ giao hàng</Text>
        {selectedAddress ? (
          <Box>
            <Text bold>{selectedAddress.name} • {selectedAddress.phone}</Text>
            <Text size="small" style={{ color: "#888", marginTop: 4 }}>
              {selectedAddress.detail}, {selectedAddress.ward}, {selectedAddress.district}, {selectedAddress.province}
            </Text>
          </Box>
        ) : (
          <Text size="small" style={{ color: "#F44336" }}>
            Chưa có địa chỉ. <span onClick={() => navigate("/addresses")} style={{ color: "#2E7D32", fontWeight: 600 }}>Thêm ngay →</span>
          </Text>
        )}
      </Box>

      {/* Items Summary */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>🛒 Sản phẩm ({cartItems.length})</Text>
        {cartItems.map(item => {
          const prod = productMap[item.pos_product_id];
          const variation = prod && (item.variant_id
            ? prod.variations.find(v => v.id === item.variant_id)
            : prod.variations[0]);
          const price = variation ? Number(variation.retail_price) : 0;
          return (
            <Box key={item.id} flex justifyContent="space-between" style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ flex: 1 }}>
                <Text size="small">{prod?.name || `#${item.pos_product_id}`}</Text>
                <Text size="xSmall" style={{ color: "#888" }}>{formatVnd(price)} × {item.qty}</Text>
              </div>
              <Text size="small" bold>{formatVnd(price * item.qty)}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Voucher */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>🎟️ Mã giảm giá</Text>
        {!voucherApplied?.valid ? (
          <Box style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input
                value={voucherCode}
                onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                placeholder="Nhập mã"
              />
            </div>
            <Button size="small" loading={voucherChecking} onClick={checkVoucher}>Áp dụng</Button>
          </Box>
        ) : (
          <Box flex justifyContent="space-between" alignItems="center" style={{ background: "#f0fdf4", padding: 10, borderRadius: 8 }}>
            <div>
              <Text size="small" bold style={{ color: "#15803d" }}>✓ {voucherApplied.code}</Text>
              <Text size="xSmall" style={{ color: "#166534" }}>Giảm {formatVnd(voucherApplied.discount_vnd || "0")}</Text>
            </div>
            <Button size="small" variant="secondary" onClick={clearVoucher}>Bỏ</Button>
          </Box>
        )}
      </Box>

      {/* Points */}
      {pointsBalance && pointsBalance.balance >= pointsBalance.config.min_redeem && (
        <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
          <Text bold size="normal" style={{ marginBottom: 4 }}>⭐ Dùng điểm thưởng</Text>
          <Text size="xSmall" style={{ color: "#666", marginBottom: 8 }}>
            Bạn có <b>{pointsBalance.balance.toLocaleString()}</b> điểm · 1 điểm = {pointsBalance.config.vnd_per_point} ₫ · tối thiểu {pointsBalance.config.min_redeem} điểm
          </Text>
          <Input
            value={pointsToRedeem}
            onChange={e => setPointsToRedeem(e.target.value.replace(/\D/g, ""))}
            placeholder="Số điểm muốn dùng"
          />
          {pointsError && <Text size="xSmall" style={{ color: "#991b1b", marginTop: 4 }}>{pointsError}</Text>}
          {pointsDiscount > 0 && (
            <Text size="xSmall" style={{ color: "#15803d", marginTop: 4 }}>
              Giảm {formatVnd(pointsDiscount)}
            </Text>
          )}
        </Box>
      )}

      {/* Payment Method */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 10 }}>💳 Phương thức thanh toán</Text>
        {paymentOptions.map(opt => (
          <div
            key={opt.value}
            onClick={() => setPaymentMethod(opt.value)}
            style={{
              padding: "12px 14px", borderRadius: 10,
              border: `2px solid ${paymentMethod === opt.value ? "#2E7D32" : "#e8e8e8"}`,
              background: paymentMethod === opt.value ? "#E8F5E9" : "#fff",
              marginBottom: 8, fontSize: 14, cursor: "pointer",
            }}
          >
            {opt.label}
          </div>
        ))}
      </Box>

      {/* Notes */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>📝 Ghi chú</Text>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Ghi chú cho shop (tùy chọn)"
          style={{
            width: "100%", padding: 12, borderRadius: 10, border: "1px solid #e8e8e8",
            fontSize: 14, resize: "none", minHeight: 60, fontFamily: "inherit",
          }}
        />
      </Box>

      {/* Breakdown */}
      <Box p={4} style={{ background: "#fff", marginBottom: 100 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>💰 Tổng kết</Text>
        <BreakdownRow label="Tạm tính" value={formatVnd(subtotal)} />
        {voucherDiscount > 0 && <BreakdownRow label={`Voucher ${voucherApplied?.code}`} value={`-${formatVnd(voucherDiscount)}`} color="#15803d" />}
        {pointsDiscount > 0 && <BreakdownRow label={`Điểm thưởng (${pointsToRedeem} pts)`} value={`-${formatVnd(pointsDiscount)}`} color="#15803d" />}
        <div style={{ borderTop: "1px solid #e8e8e8", marginTop: 8, paddingTop: 8 }}>
          <BreakdownRow label="Tổng thanh toán" value={formatVnd(finalTotal)} bold />
        </div>
      </Box>

      {/* Submit */}
      <div className="sticky-bottom">
        <div className="sticky-bottom__total">
          <div style={{ fontSize: 11, color: "#888" }}>Tổng</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#2E7D32" }}>{formatVnd(finalTotal)}</div>
        </div>
        <button
          className="sticky-bottom__btn"
          onClick={handleOrder}
          disabled={submitting || !selectedAddress || subtotal <= 0 || !!pointsError}
        >
          {submitting ? "Đang đặt..." : "✅ Xác nhận đặt hàng"}
        </button>
      </div>
    </Box>
  );
};

const BreakdownRow: React.FC<{ label: string; value: string; bold?: boolean; color?: string }> = ({ label, value, bold, color }) => (
  <Box flex justifyContent="space-between" style={{ padding: "4px 0" }}>
    <Text size="small" bold={bold}>{label}</Text>
    <Text size={bold ? "large" : "small"} bold={bold} style={{ color: color || (bold ? "#2E7D32" : undefined) }}>{value}</Text>
  </Box>
);

export default CheckoutPage;
