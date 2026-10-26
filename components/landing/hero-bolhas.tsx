import { Avatar } from "@/components/ui";
import s from "./landing.module.css";

/**
 * A conversa que se repete ao lado do título (no lugar da foto com balões do Manychat): o
 * comentário chega, o direct sai com o botão do link e a pessoa responde. Só CSS, em loop de 9 s;
 * com "reduzir movimento" fica parada, com as três à mostra. É desenho: aria-hidden.
 */
export function HeroBolhas() {
  return (
    <div className={s.bolhas} data-bolhas aria-hidden="true">
      <div className={`${s.bolha} ${s.bolhaComentario}`} data-bolha="comentario">
        <span className={s.avatarAna}>A</span>
        <p>
          <b>ana.luiza.rs</b> comentou no teu post
          <span className={s.bolhaPalavra}>RECEITA 🙏</span>
        </p>
      </div>

      <div className={`${s.bolha} ${s.bolhaDm}`} data-bolha="dm">
        <div className={s.bolhaDe}>
          <Avatar src="/demo/avatar" nome="cafe.da.serra" className="size-5 ring-1" />
          cafe.da.serra · agora
        </div>
        <p>Oi! Aqui está a receita do bolo de cenoura da vó, com o passo a passo 👇</p>
        <span className={s.bolhaBotao}>Ver a receita</span>
      </div>

      <div className={`${s.bolha} ${s.bolhaResposta}`} data-bolha="resposta">
        <span className={s.avatarAna}>A</span>
        <p>Amei!! Já salvei aqui 😍</p>
      </div>
    </div>
  );
}
