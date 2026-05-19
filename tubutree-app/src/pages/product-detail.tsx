// Product Detail Page — Cải thiện UI
import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, Spinner, useSnackbar } from "zmp-ui";
import { useParams, useNavigate } from "react-router-dom";
import { productApi, cartApi, meApi, agentPricingApi, affiliateHubApi } from "services/api";
import { useSetRecoilState } from "recoil";
import { cartItemsState } from "state/cart";
import { formatPrice } from "utils/format";
import type { Product, ProductVariation, MyCapabilities } from "types";

// Placeholder SVG
const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect fill='%23f0f0f0' width='400' height='400'/%3E%3Ctext x='50%25' y='45%25' text-anchor='middle' fill='%23ccc' font-size='60'%3E🌳%3C/text%3E%3Ctext x='50%25' y='58%25' text-anchor='middle' fill='%23bbb' font-size='16' font-family='sans-serif'%3ETubu Tree%3C/text%3E%3C/svg%3E";

function safeImage(product: Product): string {
  if (product.image) return product.image;
  const v = product.variations?.[0];
  if (v?.images?.[0]) return v.images[0];
  return PLACEHOLDER_IMG;
}

const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const setCart = useSetRecoilState(cartItemsState);

  const [product, setProduct] = useState<Product | null>(null);
  const [selectedVariation, setSelectedVariation] = useState<ProductVariation | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(false);

  // Role-based extras
  const [caps, setCaps] = useState<MyCapabilities | null>(null);
  const [wholesalePrice, setWholesalePrice] = useState<number | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadProduct(id);
    // Load capabilities song song — silent fail nếu chưa login
    meApi.getCapabilities().then(setCaps).catch(() => {});
  }, [id]);

  // Khi xác định được caps + price → compute giá sỉ + load referral code
  useEffect(() => {
    if (!caps || !selectedVariation) return;
    const retail = Number(selectedVariation.retail_price || 0);

    if (caps.user.agent_enabled && retail > 0) {
      agentPricingApi.previewWholesale(retail)
        .then(r => setWholesalePrice(r.wholesale ? Number(r.wholesale) : null))
        .catch(() => {});
    } else {
      setWholesalePrice(null);
    }

    if (caps.user.affiliate_enabled && !referralCode) {
      affiliateHubApi.getProfile()
        .then(p => setReferralCode(p.referral_code))
        .catch(() => {});
    }
  }, [caps, selectedVariation, referralCode]);

  const loadProduct = async (productId: string) => {
    setLoading(true);
    setError(false);
    try {
      const res = await productApi.getDetail(productId);
      // Pancake API might wrap in { data: ... }
      const data = (res as any)?.data || res;
      if (data && data.name) {
        setProduct(data);
        if (data.variations?.length) {
          setSelectedVariation(data.variations[0]);
        }
      } else {
        setError(true);
      }
    } catch (err) {
      console.error("Lỗi tải sản phẩm:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = async () => {
    if (!product || !selectedVariation) return;
    setAdding(true);
    try {
      await cartApi.add(product.id, qty, selectedVariation.id);
      const allItems = await cartApi.getAll();
      setCart(allItems);
      openSnackbar({ text: "Đã thêm vào giỏ hàng! 🛒", type: "success" });
    } catch (err) {
      openSnackbar({ text: "Vui lòng đăng nhập trước", type: "error" });
    } finally {
      setAdding(false);
    }
  };

  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
  }, []);

  const handleShare = (prod: Product, code: string) => {
    const base = "https://zalo.me/s/565779011239360460";
    const link = `${base}/?ref=${code}&product=${encodeURIComponent(prod.id)}`;
    const text = `${prod.name} - Mua tại Tubu Tree:\n${link}`;

    const fallbackCopy = () => {
      navigator.clipboard.writeText(link).then(
        () => openSnackbar({ text: "Đã copy link giới thiệu", type: "success" }),
        () => openSnackbar({ text: link, type: "info" }),
      );
    };

    if (typeof navigator.share === "function") {
      try {
        // Một số webview throw sync nếu scheme không support → bọc try/catch
        const p = navigator.share({ title: prod.name, text, url: link });
        if (p && typeof p.then === "function") {
          p.catch(fallbackCopy);
        }
      } catch {
        fallbackCopy();
      }
    } else {
      fallbackCopy();
    }
  };

  if (loading) {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ minHeight: "60vh" }}>
        <Spinner visible />
        <Text style={{ marginTop: 12, color: "#888" }}>Đang tải sản phẩm...</Text>
      </Box>
    );
  }

  if (error || !product) {
    return (
      <div className="empty-state" style={{ minHeight: "60vh" }}>
        <div className="empty-state__icon">😢</div>
        <div className="empty-state__title">Không tìm thấy sản phẩm</div>
        <div className="empty-state__desc">Sản phẩm có thể đã bị xóa hoặc không tồn tại</div>
        <button className="sticky-bottom__btn" onClick={() => navigate("/")}>← Về trang chủ</button>
      </div>
    );
  }

  const price = selectedVariation?.retail_price || product.variations?.[0]?.retail_price || 0;

  return (
    <Box style={{ paddingBottom: 70 }}>
      {/* Back button + Product Image */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            position: "absolute", top: 12, left: 12, zIndex: 10,
            width: 36, height: 36, borderRadius: 18, background: "rgba(0,0,0,0.4)",
            border: "none", color: "#fff", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ←
        </button>
        <img
          src={safeImage(product)}
          alt={product.name}
          onError={handleImageError}
          style={{ width: "100%", aspectRatio: "1", objectFit: "cover", background: "#f0f0f0", display: "block" }}
        />
      </div>

      {/* Product Info */}
      <Box p={4} style={{ background: "#fff" }}>
        <Text size="xLarge" bold style={{ lineHeight: 1.4 }}>{product.name}</Text>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#F44336" }}>
            {formatPrice(price)}
          </span>
          {wholesalePrice != null && (
            <span style={{ fontSize: 14, color: "#888", textDecoration: "line-through" }}>
              {formatPrice(price)}
            </span>
          )}
        </div>

        {/* Wholesale price card cho Agent */}
        {wholesalePrice != null && caps?.user.agent_enabled && (
          <div style={{
            marginTop: 12, background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <Text size="xSmall" style={{ color: "#15803d" }}>🏪 Giá sỉ cho Đại lý</Text>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#15803d" }}>{formatPrice(wholesalePrice)}</div>
              <Text size="xSmall" style={{ color: "#166534" }}>
                Tiết kiệm {formatPrice(price - wholesalePrice)} / sản phẩm
              </Text>
            </div>
            <button
              onClick={() => navigate("/agent-hub")}
              style={{ border: "none", background: "#15803d", color: "#fff", padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
            >Xem hạng</button>
          </div>
        )}

        {/* Share button cho CTV */}
        {referralCode && caps?.user.affiliate_enabled && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => handleShare(product, referralCode)}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: "1px dashed #2E7D32", background: "#E8F5E9",
                color: "#2E7D32", fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}
            >
              🔗 Chia sẻ link kiếm hoa hồng
            </button>
          </div>
        )}

        {product.note_product && (
          <Text size="small" style={{ color: "#888", marginTop: 12, lineHeight: 1.6 }}>
            {product.note_product}
          </Text>
        )}
      </Box>

      {/* Variations */}
      {product.variations && product.variations.length > 1 && (
        <Box p={4} mt={2} style={{ background: "#fff" }}>
          <Text size="normal" bold style={{ marginBottom: 12 }}>📦 Phân loại</Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {product.variations.map(v => (
              <div
                key={v.id}
                onClick={() => setSelectedVariation(v)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 20,
                  border: `2px solid ${selectedVariation?.id === v.id ? '#2E7D32' : '#e8e8e8'}`,
                  background: selectedVariation?.id === v.id ? '#E8F5E9' : '#fff',
                  fontSize: 13,
                  fontWeight: selectedVariation?.id === v.id ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {v.name || v.sku}
                <span style={{ color: "#F44336", marginLeft: 4, fontWeight: 600 }}>
                  {formatPrice(v.retail_price)}
                </span>
              </div>
            ))}
          </div>
        </Box>
      )}

      {/* Quantity */}
      <Box p={4} mt={2} style={{ background: "#fff" }}>
        <Text size="normal" bold style={{ marginBottom: 12 }}>🔢 Số lượng</Text>
        <div className="cart-item__qty">
          <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <span>{qty}</span>
          <button onClick={() => setQty(qty + 1)}>+</button>
        </div>
      </Box>

      {/* Sticky Bottom */}
      <div className="sticky-bottom">
        <div className="sticky-bottom__total">
          Tổng cộng
          <span>{formatPrice(price * qty)}</span>
        </div>
        <button
          className="sticky-bottom__btn"
          onClick={handleAddToCart}
          disabled={adding}
        >
          {adding ? "Đang thêm..." : "🛒 Thêm vào giỏ"}
        </button>
      </div>
    </Box>
  );
};

export default ProductDetailPage;
