import { PRODUTO, SITE_URL } from "@/lib/config";

// Dados estruturados (JSON-LD) da home: dizem ao Google quem é a empresa, o site e o produto.
// O nome "Gatlo" parece "gato" pro Google; é isto, com o nome da empresa, que firma a marca.
export function DadosEstruturados({ precoMensal }: { precoMensal?: string }) {
  const dados = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#empresa`,
        name: PRODUTO.empresa,
        url: "https://mxdigital.ia.br",
        email: PRODUTO.emailSuporte,
        address: { "@type": "PostalAddress", addressLocality: "Lajeado", addressRegion: "RS", addressCountry: "BR" },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#site`,
        url: SITE_URL,
        name: PRODUTO.nome,
        alternateName: ["Gatlo", "Gatlo AI Instagram"],
        inLanguage: "pt-BR",
        publisher: { "@id": `${SITE_URL}/#empresa` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#produto`,
        name: PRODUTO.nome,
        url: SITE_URL,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "Quem comenta a palavra no post do Instagram recebe o link na DM, sozinho, numa fila que respeita o limite da Meta.",
        publisher: { "@id": `${SITE_URL}/#empresa` },
        ...(precoMensal
          ? { offers: { "@type": "Offer", price: precoMensal, priceCurrency: "BRL", url: `${SITE_URL}/cadastro` } }
          : {}),
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dados).replace(/</g, "\\u003c") }} />;
}
