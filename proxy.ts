import { type NextRequest } from "next/server";
import { atualizarSessao } from "@/lib/supabase/proxy";

// No Next 16 o antigo middleware.ts virou proxy.ts (roda sempre em Node.js).
export async function proxy(request: NextRequest) {
  return await atualizarSessao(request);
}

export const config = {
  matcher: [
    /*
     * Tudo, menos: arquivos do Next, imagens, as miniaturas do modo
     * demonstração (/demo) e o link curto (/l), que não precisam de sessão.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|demo/|l/|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
