/** Tema do painel: a escolha salva fica no localStorage e vira <html data-tema>. */
export const CHAVE_TEMA = "gatlo-tema";

/** Roda no <head> do layout raiz, antes de pintar, pra não piscar o claro em quem escolheu escuro. */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem("${CHAVE_TEMA}");if(t==="claro"||t==="escuro")document.documentElement.dataset.tema=t}catch(e){}`;
