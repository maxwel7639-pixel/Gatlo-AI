"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  cadastrar,
  entrar,
  recuperarSenha,
  trocarSenha,
  type EstadoAuth,
} from "@/lib/auth/acoes";
import { Aviso, Campo, classeBotao, classeEntrada } from "./ui";

const inicial: EstadoAuth = {};

function Mensagens({ estado }: { estado: EstadoAuth }) {
  return (
    <>
      {estado.erro ? <Aviso tipo="erro">{estado.erro}</Aviso> : null}
      {estado.aviso ? (
        <Aviso tipo="ok">
          {estado.aviso}
          {estado.link ? (
            <>
              {" "}
              <Link href={estado.link} className="font-semibold underline">
                Trocar a senha agora
              </Link>
            </>
          ) : null}
        </Aviso>
      ) : null}
    </>
  );
}

function CampoSenha({ id, autoComplete }: { id: string; autoComplete: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        name="senha"
        type={ver ? "text" : "password"}
        required
        minLength={8}
        autoComplete={autoComplete}
        className={`${classeEntrada} pr-20`}
      />
      <button
        type="button"
        onClick={() => setVer((v) => !v)}
        className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2.5 text-xs font-semibold text-suave hover:text-texto"
      >
        {ver ? "Esconder" : "Mostrar"}
      </button>
    </div>
  );
}

export function FormEntrar({ proximo }: { proximo: string }) {
  const [estado, acao, enviando] = useActionState(entrar, inicial);
  return (
    <form action={acao} className="space-y-5">
      <input type="hidden" name="proximo" value={proximo} />
      <Campo rotulo="E-mail" htmlFor="email">
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={estado.email} className={classeEntrada} />
      </Campo>
      <Campo
        rotulo="Senha"
        htmlFor="senha"
        extra={
          <Link href="/recuperar-senha" className="text-xs font-semibold text-azul-claro hover:underline">
            Esqueci a senha
          </Link>
        }
      >
        <CampoSenha id="senha" autoComplete="current-password" />
      </Campo>
      <Mensagens estado={estado} />
      <button type="submit" disabled={enviando} className={`${classeBotao()} w-full`}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

export function FormCadastro() {
  const [estado, acao, enviando] = useActionState(cadastrar, inicial);
  return (
    <form action={acao} className="space-y-5">
      <Campo rotulo="Teu nome" htmlFor="nome">
        <input id="nome" name="nome" required maxLength={80} autoComplete="name" defaultValue={estado.nome} className={classeEntrada} />
      </Campo>
      <Campo rotulo="E-mail" htmlFor="email">
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={estado.email} className={classeEntrada} />
      </Campo>
      <Campo rotulo="Senha" htmlFor="senha" dica="Pelo menos 8 caracteres.">
        <CampoSenha id="senha" autoComplete="new-password" />
      </Campo>
      <label className="flex items-start gap-3 text-sm leading-relaxed text-suave">
        <input
          type="checkbox"
          name="aceite"
          required
          className="mt-0.5 size-4 shrink-0 accent-[var(--azul)]"
        />
        <span>
          Li e aceito os{" "}
          <Link href="/termos" target="_blank" className="text-azul-claro underline">
            termos de uso
          </Link>{" "}
          e a{" "}
          <Link href="/privacidade" target="_blank" className="text-azul-claro underline">
            política de privacidade
          </Link>
          .
        </span>
      </label>
      <Mensagens estado={estado} />
      <button type="submit" disabled={enviando} className={`${classeBotao()} w-full`}>
        {enviando ? "Criando a conta…" : "Começar o teste grátis"}
      </button>
    </form>
  );
}

export function FormRecuperar() {
  const [estado, acao, enviando] = useActionState(recuperarSenha, inicial);
  return (
    <form action={acao} className="space-y-5">
      <Campo rotulo="E-mail da conta" htmlFor="email">
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={estado.email} className={classeEntrada} />
      </Campo>
      <Mensagens estado={estado} />
      <button type="submit" disabled={enviando} className={`${classeBotao()} w-full`}>
        {enviando ? "Enviando…" : "Mandar o link"}
      </button>
    </form>
  );
}

export function FormNovaSenha({ codigo }: { codigo: string }) {
  const [estado, acao, enviando] = useActionState(trocarSenha, inicial);
  return (
    <form action={acao} className="space-y-5">
      <input type="hidden" name="codigo" value={codigo} />
      <Campo rotulo="Senha nova" htmlFor="senha" dica="Pelo menos 8 caracteres.">
        <CampoSenha id="senha" autoComplete="new-password" />
      </Campo>
      <Mensagens estado={estado} />
      <button type="submit" disabled={enviando} className={`${classeBotao()} w-full`}>
        {enviando ? "Salvando…" : "Salvar a senha nova"}
      </button>
    </form>
  );
}
