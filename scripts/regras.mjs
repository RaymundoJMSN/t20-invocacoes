// Regras puras do Espírito Balístico (HdA p. 252). Sem Foundry aqui.
// Nomes dos aprimoramentos como estão no item da magia (começo do texto basta).
const APR = {
  dado: "aumenta o dano em um dado",
  dois: "muda o número de espíritos para dois",
  tres: "muda o número de espíritos para três",
  elemental: "(Apenas Golem",
};

/**
 * Fórmula compacta a partir dos termos de um Roll já rolado (dados + soma dos números).
 * Traz tudo que o conjurador tinha na rolagem: aprimoramentos, Arcano de Batalha, modificadores.dano.mag...
 * @param {{faces?:number, number?:number, class?:string, operator?:string}[]} terms
 */
export function formulaDoRoll(terms) {
  const dados = [];
  let fixo = 0, sinal = 1;
  for (const t of terms) {
    if (t.operator !== undefined) { sinal = t.operator === "-" ? -1 : 1; continue; }
    if (t.faces) { dados.push(`${sinal < 0 ? "-" : ""}${t.number ?? 1}d${t.faces}`); }
    else if (t.number !== undefined) fixo += sinal * Number(t.number);
    sinal = 1;
  }
  if (!dados.length) return null;
  return dados.join("+") + (fixo ? (fixo > 0 ? `+${fixo}` : `${fixo}`) : "");
}

/** Círculo máximo de conjurador completo pelo nível de personagem (1º/5º/9º/13º/17º). */
export function circuloPorNivel(nivel) {
  return Math.clamp ? Math.clamp(Math.floor(((Number(nivel) || 1) - 1) / 4) + 1, 1, 5)
    : Math.min(5, Math.max(1, Math.floor(((Number(nivel) || 1) - 1) / 4) + 1));
}

/**
 * @param {{description:string, qty:number}[]} onUseEffects  flags.tormenta20.onUseEffects do card
 * @param {{circuloMax:number, tipoElemental?:string}} ctx
 * @returns {{quantidade:number, formula:string, tipo:string, dados:number}}
 */
export function espiritoBalistico(onUseEffects = [], { circuloMax = 1, tipoElemental = "" } = {}) {
  const qtd = (chave) => onUseEffects
    .filter((e) => (e.description ?? "").trim().startsWith(APR[chave]))
    .reduce((s, e) => s + (Number(e.qty) || 1), 0);

  // dados extras limitados pelo círculo máximo (1 dado base + extras ≤ círculo)
  const dados = Math.min(1 + qtd("dado"), Math.max(1, circuloMax));
  const elemental = qtd("elemental") > 0;
  const dado = elemental ? "d8" : "d6";
  const tipo = elemental && tipoElemental ? tipoElemental : "perfuracao";
  const quantidade = qtd("tres") ? 3 : qtd("dois") ? 2 : 1;
  return { quantidade, formula: `${dados}${dado}+1`, tipo, dados };
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("regras.mjs") && process.argv.includes("--check")) {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  const e = (description, qty = 1) => ({ description, qty });
  let r = espiritoBalistico([], { circuloMax: 1 });
  assert(r.quantidade === 1 && r.formula === "1d6+1" && r.tipo === "perfuracao", "base");
  r = espiritoBalistico([e(APR.dado, 2)], { circuloMax: 3 });
  assert(r.formula === "3d6+1", "2 dados extras no 3º círculo");
  r = espiritoBalistico([e(APR.dado, 4)], { circuloMax: 2 });
  assert(r.formula === "2d6+1", "limite pelo círculo");
  r = espiritoBalistico([e(APR.dois)], { circuloMax: 2 });
  assert(r.quantidade === 2, "dois espíritos");
  r = espiritoBalistico([e(APR.dois), e(APR.tres)], { circuloMax: 3 });
  assert(r.quantidade === 3, "três vence dois");
  r = espiritoBalistico([e(APR.elemental + " [energia elemental]...")], { circuloMax: 1, tipoElemental: "fogo" });
  assert(r.formula === "1d8+1" && r.tipo === "fogo", "elemental d8 + tipo");
  r = espiritoBalistico([e(APR.elemental)], { circuloMax: 1 });
  assert(r.tipo === "perfuracao", "elemental sem tipo escolhido cai em perfuração");
  assert(circuloPorNivel(1) === 1 && circuloPorNivel(4) === 1 && circuloPorNivel(5) === 2 && circuloPorNivel(17) === 5 && circuloPorNivel(20) === 5, "círculo por nível");
  const d = (number, faces) => ({ number, faces }), n = (number) => ({ number }), op = (operator) => ({ operator });
  assert(formulaDoRoll([d(5, 6), op("+"), n(1), op("+"), n(5)]) === "5d6+6", "dados + fixos somados");
  assert(formulaDoRoll([d(1, 8), op("+"), n(1), op("-"), n(3)]) === "1d8-2", "subtração");
  assert(formulaDoRoll([n(4)]) === null, "sem dado devolve null");
  console.log("regras.mjs: 11 casos OK");
}
