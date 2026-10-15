import "server-only";
import { agoraIso, ler, mudar, novoId } from "../local/banco";
import { REGRAS_DEMONSTRACAO } from "../regras";
import { gerarComentarios } from "./simulacao";
import type { Repositorio } from "./repositorio";
import type { Automacao, ContaInstagram } from "./tipos";

/**
 * O mesmo contrato do repositório Supabase, em cima do arquivo do banco local
 * de demonstração. Os filtros por userId aqui fazem o papel do RLS.
 */

const DIA = 86400_000;
const semDono = <T extends { userId: string }>(x: T): Omit<T, "userId"> => {
  const { userId: _u, ...resto } = x;
  void _u;
  return resto;
};

export const repositorioLocal: Repositorio = {
  async contaInstagram(userId) {
    const c = ler().contas.find((x) => x.userId === userId);
    return c ? (semDono(c) as ContaInstagram) : null;
  },

  async salvarConexao(userId, c) {
    return mudar((b) => {
      const outro = b.contas.find((x) => x.igUserId === c.igUserId && x.userId !== userId);
      if (outro) return { ok: false as const, erro: "Esse Instagram já está conectado em outro cadastro." };
      const anterior = b.contas.find((x) => x.userId === userId);
      const dados = {
        igUserId: c.igUserId,
        username: c.username,
        nome: c.nome,
        fotoUrl: c.fotoUrl,
        tipoConta: c.tipoConta,
        seguidores: c.seguidores,
        demonstracao: c.demonstracao,
        status: "conectada" as const,
        conectadaEm: agoraIso(),
      };
      if (anterior) {
        if (anterior.igUserId !== c.igUserId) {
          b.automacoes.filter((a) => a.userId === userId).forEach((a) => (a.ativa = false));
        }
        Object.assign(anterior, dados);
        return { ok: true as const, conta: semDono(anterior) as ContaInstagram };
      }
      const nova = { id: novoId(), userId, ...dados };
      b.contas.push(nova);
      return { ok: true as const, conta: semDono(nova) as ContaInstagram };
    });
  },

  async desconectar(userId) {
    mudar((b) => {
      const c = b.contas.find((x) => x.userId === userId);
      if (c) c.status = "desconectada";
      b.automacoes.filter((a) => a.userId === userId).forEach((a) => (a.ativa = false));
    });
  },

  async listarAutomacoes(userId) {
    return ler()
      .automacoes.filter((a) => a.userId === userId)
      .sort((x, y) => y.criadaEm.localeCompare(x.criadaEm))
      .map((a) => semDono(a) as Automacao);
  },

  async automacao(userId, id) {
    const a = ler().automacoes.find((x) => x.id === id && x.userId === userId);
    return a ? (semDono(a) as Automacao) : null;
  },

  async criarAutomacao(userId, contaId, dados) {
    return mudar((b) => {
      if (!b.contas.some((c) => c.id === contaId && c.userId === userId)) {
        throw new Error("Essa conta do Instagram não é tua.");
      }
      if (b.automacoes.filter((a) => a.userId === userId).length >= 50) {
        throw new Error("Limite de 50 automações por cadastro.");
      }
      const nova = {
        ...dados,
        id: novoId(),
        userId,
        contaId,
        codigo: novoId().replaceAll("-", "").slice(0, 10),
        criadaEm: agoraIso(),
        atualizadaEm: agoraIso(),
      };
      b.automacoes.push(nova);
      return semDono(nova) as Automacao;
    });
  },

  async atualizarAutomacao(userId, id, dados) {
    mudar((b) => {
      const a = b.automacoes.find((x) => x.id === id && x.userId === userId);
      if (!a) return;
      Object.assign(a, dados, { atualizadaEm: agoraIso() });
    });
  },

  async excluirAutomacao(userId, id) {
    mudar((b) => {
      b.automacoes = b.automacoes.filter((x) => !(x.id === id && x.userId === userId));
      b.comentarios.forEach((c) => {
        if (c.automacaoId === id) c.automacaoId = null;
      });
      b.cliques = b.cliques.filter((c) => c.automacaoId !== id);
    });
  },

  async numeros(userId, filtro) {
    const b = ler();
    const limiteFila = Date.now() - REGRAS_DEMONSTRACAO.filaJanelaDias * DIA;
    const desde = filtro.desde ? Date.parse(filtro.desde) : 0;
    const cs = b.comentarios.filter(
      (c) =>
        c.userId === userId &&
        (!filtro.automacaoId || c.automacaoId === filtro.automacaoId) &&
        Date.parse(c.recebidoEm) >= desde,
    );
    return {
      comentarios: cs.length,
      dms: cs.filter((c) => c.dmEm).length,
      naFila: cs.filter((c) => !c.dmEm && !c.dmErro && Date.parse(c.recebidoEm) >= limiteFila).length,
      erros: cs.filter((c) => c.dmErro).length,
      cliques: b.cliques.filter(
        (k) =>
          k.userId === userId &&
          (!filtro.automacaoId || k.automacaoId === filtro.automacaoId) &&
          Date.parse(k.clicadoEm) >= desde,
      ).length,
    };
  },

  async numerosPorAutomacao(userId) {
    const saida: Record<string, Awaited<ReturnType<Repositorio["numeros"]>>> = {};
    for (const a of ler().automacoes.filter((x) => x.userId === userId)) {
      saida[a.id] = await repositorioLocal.numeros(userId, { automacaoId: a.id });
    }
    return saida;
  },

  async comentariosRecentes(userId, automacaoId, limite) {
    return ler()
      .comentarios.filter((c) => c.userId === userId && c.automacaoId === automacaoId)
      .sort((x, y) => y.recebidoEm.localeCompare(x.recebidoEm))
      .slice(0, limite)
      .map(({ userId: _u, contaId: _c, ...resto }) => {
        void _u;
        void _c;
        return resto;
      });
  },

  // A mesma regra de assinatura_situacao() do banco (0001_esquema.sql).
  async situacao(userId) {
    const a = ler().assinaturas.find((x) => x.userId === userId);
    if (!a) return null;
    const agora = Date.now();
    const trialAte = Date.parse(a.trialAte);
    const periodoAte = a.periodoAte ? Date.parse(a.periodoAte) : null;
    const carencia = REGRAS_DEMONSTRACAO.carenciaDias * DIA;
    let liberada = false;
    let status = a.status;
    if (a.status === "trial") {
      liberada = trialAte > agora;
      if (!liberada) status = "vencida";
    } else if (a.status === "ativa") {
      liberada = periodoAte !== null && periodoAte + carencia > agora;
      if (!liberada) status = "vencida";
    }
    const fim = a.status === "trial" ? trialAte : (periodoAte ?? agora);
    return {
      status,
      liberada,
      trialAte: a.trialAte,
      periodoAte: a.periodoAte,
      diasRestantes: Math.max(0, Math.ceil((fim - agora) / DIA)),
    };
  },

  async pausa(userId, contaId) {
    const p = ler().pausas.find((x) => x.contaId === contaId);
    return p ? { directAte: p.directAte, respostaAte: p.respostaAte, motivo: p.motivo } : null;
  },

  async destinoDoLink(codigo) {
    const a = ler().automacoes.find((x) => x.codigo === codigo);
    return a ? { automacaoId: a.id, userId: a.userId, linkUrl: a.linkUrl } : null;
  },

  async comentarioEhDaAutomacao(comentarioId, automacaoId) {
    return ler().comentarios.some((c) => c.id === comentarioId && c.automacaoId === automacaoId);
  },

  async registrarClique(c) {
    mudar((b) => {
      b.cliques.push({ ...c, clicadoEm: agoraIso() });
    });
  },

  async desconectarPorInstagram() {
    return 0; // conta fictícia: a Meta nunca manda aviso dela
  },

  async apagarPorInstagram() {
    return 0;
  },

  async simularComentarios(userId, automacaoId) {
    return mudar((b) => {
      const a = b.automacoes.find((x) => x.id === automacaoId && x.userId === userId);
      const conta = b.contas.find((x) => x.userId === userId);
      if (!a || !conta || !conta.demonstracao) return 0;
      const lote = gerarComentarios(a);
      for (const s of lote) {
        b.comentarios.push({
          id: s.id,
          commentId: s.commentId,
          userId,
          contaId: conta.id,
          automacaoId: a.id,
          mediaId: s.mediaId,
          autorUsername: s.autorUsername,
          texto: s.texto,
          palavra: s.palavra,
          recebidoEm: s.recebidoEm,
          dmEm: s.dmEm,
          dmErro: s.dmErro,
          respostaEm: s.respostaEm,
        });
        if (s.clicou) {
          b.cliques.push({
            automacaoId: a.id,
            userId,
            comentarioId: s.id,
            visitante: `demo-${s.autorIgId}`,
            clicadoEm: s.dmEm ?? agoraIso(),
          });
        }
      }
      return lote.length;
    });
  },
};
