// Product Detail Page
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Spinner, useSnackbar } from "zmp-ui";
import { useParams, useNavigate } from "react-router-dom";
import { productApi, cartApi } from "services/api";
import { useSetRecoilState } from "recoil";
import { cartItemsState } from "state/cart";
import { formatPrice, getProductImage } from "utils/format";
import type { Product, ProductVariation } from "types";

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

  useEffect(() => {
    if (id) loadProduct(id);
  }, [id]);

  const loadProduct = async (productId: string) => {
    try {
      const data = await productApi.getDetail(productId);
      setProduct(data);
      if (data.variations?.length) {
        setSelectedVariation(data.variations[0]);
      }
    } catch (err) {
      console.error("Lỗi tải sản phẩm:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = async () => {
    if (!product || !selectedVariation) return;
    setAdding(true);
    try {
      const item = await cartApi.add(product.id, qty, selectedVariation.id);
      // Refresh cart
      const allItems = await cartApi.getAll();
      setCart(allItems);
      openSnackbar({ text: "Đã thêm vào giỏ hàng! 🛒", type: "success" });
    } catch (err) {
      openSnackbar({ text: "Vui lòng đăng nhập trước", type: "error" });
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60 }}>
        <Spinner visible />
      </Box>
    );
  }

  if (!product) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">😢</div>
        <div className="empty-state__title">Không tìm thấy sản phẩm</div>
      </div>
    );
  }

  const price = selectedVariation?.retail_price || 0;

  return (
    <Box>
      {/* Product Image */}
      <img
        src={getProductImage(product)}
        alt={product.name}
        style={{ width: "100%", aspectRatio: "1", objectFit: "cover", background: "#eee" }}
      />

      {/* Product Info */}
      <Box p={4} style={{ background: "#fff" }}>
        <Text size="xLarge" bold>{product.name}</Text>
        <Text size="xLarge" bold style={{ color: "#F44336", marginTop: 8 }}>
          {formatPrice(price)}
        </Text>

        {product.note_product && (
          <Text size="small" style={{ color: "#888", marginTop: 8, lineHeight: 1.5 }}>
            {product.note_product}
          </Text>
        )}
      </Box>

      {/* Variations */}
      {product.variations.length > 1 && (
        <Box p={4} mt={2} style={{ background: "#fff" }}>
          <Text size="normal" bold style={{ marginBottom: 10 }}>Phân loại</Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {product.variations.map(v => (
              <div
                key={v.id}
                onClick={() => setSelectedVariation(v)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: `2px solid ${selectedVariation?.id === v.id ? '#2E7D32' : '#e8e8e8'}`,
                  background: selectedVariation?.id === v.id ? '#E8F5E9' : '#fff',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {v.name || v.sku}
              </div>
            ))}
          </div>
        </Box>
      )}

      {/* Quantity */}
      <Box p={4} mt={2} style={{ background: "#fff" }}>
        <Text size="normal" bold style={{ marginBottom: 10 }}>Số lượng</Text>
        <div className="cart-item__qty">
          <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <span>{qty}</span>
          <button onClick={() => setQty(qty + 1)}>+</button>
        </div>
      </Box>

      {/* Sticky Bottom */}
      <div className="sticky-bottom">
        <div className="sticky-bottom__total">
          Tổng
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
