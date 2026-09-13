// Regras puras do Espírito Balístico (HdA p. 252). Sem Foundry aqui.
// Nomes dos aprimoramentos como estão no item da magia (começo do texto basta).
const APR = {
  dado: "aumenta o dano em um dado",
  dois: "muda o número de espíritos para dois",
  tres: "muda o número de espíritos para três",
  elemental: "(Apenas Golem",
};

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
  console.log("regras.mjs: 7 casos OK");
}
