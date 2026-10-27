import { ImageResponse } from "next/og";
import { PRODUTO } from "@/lib/config";

// A imagem que aparece quando o link do Gatlo é colado no WhatsApp, Instagram, LinkedIn e no Google.
export const alt = `${PRODUTO.nome}: comentou a palavra, recebeu o link na DM`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function ImagemSocial() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: "72px 80px", background: "#07090c", color: "#f3f6fb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72, height: 72, borderRadius: 20, background: "#1e50f0", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 46, fontWeight: 800, color: "#fff",
            }}
          >
            G
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{PRODUTO.nome}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>
            Comentou a palavra, recebeu o link na DM.
          </div>
          <div style={{ fontSize: 34, color: "#7fa6ff" }}>Automação de comentário para DM no Instagram</div>
        </div>
      </div>
    ),
    size,
  );
}
