import { NextResponse, type NextRequest } from "next/server";
import { usuarioAtual } from "@/lib/auth/sessao";
import { COOKIE_ESTADO_OAUTH } from "@/lib/auth/nomes";
import { instagramDemonstracao } from "@/lib/env";
import { repo } from "@/lib/dados";
import { ErroMeta, inscreverComentarios, lerPerfil, tokenLongo, trocarCodigo } from "@/lib/instagram/meta";
import { cifrar, iguais } from "@/lib/cripto";

/**
 * Volta do login do Instagram (o "redirect URI" cadastrado no app da Meta:
 * <site>/api/instagram/callback).
 *
 * 1. confere o state (cookie de /conectar) e que é a MESMA pessoa logada;
 * 2. troca o code pelo token curto e o curto pelo longo (~60 dias);
 * 3. lê o perfil, cifra o token e guarda (só o servidor lê);
 * 4. inscreve a conta no webhook de comentários (falha aqui não derruba a conexão).
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const voltar = (caminho: string) => {
    const r = NextResponse.redirect(`${origin}${caminho}`);
    r.cookies.set(COOKIE_ESTADO_OAUTH, "", { path: "/api/instagram", maxAge: 0 });
    return r;
  };

  if (instagramDemonstracao) return voltar("/painel/conta");

  const usuario = await usuarioAtual();
  if (!usuario) return voltar("/entrar?proximo=/painel/conta");

  // A pessoa clicou em "Cancelar" no Instagram.
  if (searchParams.get("error")) return voltar("/painel/conta?erro=negado");

  const [estadoGuardado, dono] = (request.cookies.get(COOKIE_ESTADO_OAUTH)?.value ?? "").split(".");
  const estado = searchParams.get("state") ?? "";
  const codigo = (searchParams.get("code") ?? "").replace(/#_$/, "");
  if (!codigo || !estado || !estadoGuardado || !iguais(estado, estadoGuardado) || dono !== usuario.id) {
    return voltar("/painel/conta?erro=estado");
  }

  try {
    const { tokenCurto, permissoes } = await trocarCodigo(codigo);
    const longo = await tokenLongo(tokenCurto);
    const perfil = await lerPerfil(longo.token);

    const r = await repo().salvarConexao(usuario.id, {
      ...perfil,
      demonstracao: false,
      tokenCifrado: cifrar(longo.token),
      tokenExpiraEm: longo.expiraEm,
      escopos: permissoes,
    });
    if (!r.ok) return voltar("/painel/conta?erro=ja_conectada");

    // Inscreve a conta no webhook de comentários. Se falhar, a conexão fica de pé
    // (a conta já está salva): só registra, e a consulta de reserva da fase B cobre.
    // O modo demonstração nem chega aqui (volta no começo, sem chamar a Meta).
    try {
      await inscreverComentarios(longo.token);
    } catch (e) {
      console.error("[instagram/callback] inscrição no webhook falhou", e instanceof ErroMeta ? `${e.codigo} ${e.message}` : e);
    }

    // Sem as permissões de comentário e mensagem o robô não funciona.
    const faltam = ["instagram_business_manage_comments", "instagram_business_manage_messages"].filter(
      (p) => permissoes.length && !permissoes.includes(p),
    );
    return voltar(faltam.length ? "/painel/conta?aviso=permissoes" : "/painel?conectado=1");
  } catch (e) {
    console.error("[instagram/callback]", e instanceof ErroMeta ? `${e.codigo} ${e.message}` : e);
    return voltar("/painel/conta?erro=meta");
  }
}
