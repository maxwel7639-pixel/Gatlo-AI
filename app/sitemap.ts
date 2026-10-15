import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/cadastro", "/termos", "/privacidade", "/exclusao-de-dados"].map((caminho) => ({
    url: `${SITE_URL}${caminho}`,
  }));
}
