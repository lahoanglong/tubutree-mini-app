/**
 * KycImage — Render ảnh KYC qua signed URL (HMAC ngắn hạn).
 * Tự mint signed URL khi mount; fallback rỗng nếu lỗi.
 */
import React, { useEffect, useState } from "react";
import { mintKycSignedUrl } from "services/api";

interface Props {
  relativeUrl: string | null | undefined;
  alt?: string;
  style?: React.CSSProperties;
}

export const KycImage: React.FC<Props> = ({ relativeUrl, alt, style }) => {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!relativeUrl) { setSrc(""); return; }
    mintKycSignedUrl(relativeUrl).then(url => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [relativeUrl]);

  if (!src) {
    return <div style={{ ...style, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 12 }}>{alt || "…"}</div>;
  }
  return <img src={src} alt={alt} style={style} referrerPolicy="no-referrer" />;
};

export default KycImage;
