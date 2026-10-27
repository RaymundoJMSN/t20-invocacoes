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

// ─── Conjurar Monstro (LB p. 186) e Conjurar Mortos-Vivos (LB p. 186 + AdA) ──────────────────
// Os aprimoramentos chegam pelo texto (flags.tormenta20.onUseEffects[].description = nome do efeito
// no item da magia). Casa por trecho sem acento, pra valer com a ficha do compêndio e com edições.
const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const vezes = (aprs, trecho) => aprs.filter((e) => sem(e.description).includes(trecho))
  .reduce((s, e) => s + (Number(e.qty) || 1), 0);
const achar = (aprs, trecho) => aprs.filter((e) => sem(e.description).includes(trecho));

export const TAMANHOS = ["peq", "med", "gra", "eno", "col"];   // categoria a partir de Pequeno
export const LADO_TOKEN = { peq: 1, med: 1, gra: 2, eno: 3, col: 6 };   // quadrados de 1,5 m
const NOME_TAMANHO = { medio: "med", grande: "gra", enorme: "eno", colossal: "col" };

/** Valores do Livro Básico, pra quando o texto do aprimoramento não der pra ler. */
const MONSTRO_LIVRO = {
  peq: { for: 2, des: 3, pv: 20, desl: 9, dano: "2d4+2", alcance: 1.5 },
  med: { for: 4, des: 3, pv: 45, desl: 12, dano: "2d6+4", alcance: 1.5 },
  gra: { for: 7, des: 2, pv: 75, desl: 12, dano: "3d6+7", alcance: 3 },
  eno: { for: 11, des: 1, pv: 110, desl: 15, dano: "4d6+11", alcance: 4.5 },
  col: { for: 15, des: 0, pv: 180, desl: 15, dano: "6d6+15", alcance: 9 },
};

/** "Ele tem For 7, Des 2, 75 PV, deslocamento 12m e seu ataque causa 4d6+10 pontos de dano com 3m
 * de alcance." Texto antigo do livro ("For 24, Des 14") é escala 10–20: vira modificador. */
export function lerTamanho(texto) {
  const t = sem(texto);
  const tam = NOME_TAMANHO[/tamanho do monstro para (\w+)/.exec(t)?.[1]];
  if (!tam) return null;
  const m = /for (\d+), des (\d+), (\d+) pv, deslocamento (\d+)\s*m e seu ataque causa (\d+d\d+(?:\s*\+\s*\d+)?)(?: pontos de dano)?(?: com ([\d,.]+)\s*m de alcance)?/.exec(t);
  if (!m) return { tamanho: tam, ...MONSTRO_LIVRO[tam] };
  let [, f, d, pv, desl, dano, alc] = m;
  [f, d] = [Number(f), Number(d)];
  if (d >= 10) [f, d] = [Math.floor((f - 10) / 2), Math.floor((d - 10) / 2)];
  return { tamanho: tam, for: f, des: d, pv: Number(pv), desl: Number(desl), dano: dano.replace(/\s+/g, ""),
    alcance: alc ? Number(alc.replace(",", ".")) : MONSTRO_LIVRO[tam].alcance };
}

/** O que perguntar ao jogador antes de invocar (cada um só se o aprimoramento foi marcado). */
export function perguntasMonstro(aprs = []) {
  return {
    elemental: vezes(aprs, "muda o tipo de dano do ataque") > 0,
    escaladaOuNatacao: vezes(aprs, "escalada ou natacao") > 0,
    resistencias: vezes(aprs, "resistencia 5 contra dois tipos") > 0,
    imunidades: vezes(aprs, "imunidade contra dois tipos") > 0,
  };
}

/**
 * @param {{description:string, qty:number}[]} aprs  aprimoramentos marcados no card
 * @param {{tipoDano?:string, escaladaOuNatacao?:"climb"|"swim", resistencias?:string[], imunidades?:string[]}} escolhas
 */
export function conjurarMonstro(aprs = [], escolhas = {}) {
  // o maior tamanho marcado vence (o diálogo deixa marcar mais de um)
  const tamanhos = achar(aprs, "tamanho do monstro para").map((e) => lerTamanho(e.description)).filter(Boolean);
  const t = tamanhos.sort((a, b) => TAMANHOS.indexOf(b.tamanho) - TAMANHOS.indexOf(a.tamanho))[0]
    ?? { tamanho: "peq", ...MONSTRO_LIVRO.peq };
  const categoria = TAMANHOS.indexOf(t.tamanho) + 1;
  const walk = t.desl + 3 * vezes(aprs, "aumenta o deslocamento do monstro");
  const pv = t.pv + 10 * categoria * vezes(aprs, "aumenta os pv do monstro");
  const desl = { walk, climb: 0, swim: 0, fly: 0 };
  if (vezes(aprs, "escalada ou natacao")) desl[escolhas.escaladaOuNatacao === "swim" ? "swim" : "climb"] = walk;
  if (vezes(aprs, "deslocamento de voo")) desl.fly = 2 * walk;
  const tipo = escolhas.tipoDano || "corte";
  return {
    tamanho: t.tamanho, for: t.for, des: t.des, pv, desl,
    ataque: { formula: t.dano, tipo, alcance: t.alcance },
    sopro: vezes(aprs, "arma de sopro") > 0,
    cegas: vezes(aprs, "percepcao as cegas") > 0,
    resistencias: vezes(aprs, "resistencia 5 contra dois tipos") ? (escolhas.resistencias ?? []).slice(0, 2) : [],
    imunidades: vezes(aprs, "imunidade contra dois tipos") ? (escolhas.imunidades ?? []).slice(0, 2) : [],
  };
}

/** Os mortos-vivos da magia. Defesa null = "não têm valor de Defesa" (ataques acertam sempre). */
export const MORTOS_VIVOS = {
  esqueleto: { nome: "Esqueleto Conjurado", tamanho: "med", for: 2, des: 2, pv: 1, desl: { walk: 9 }, defesa: null,
    danos: [{ formula: "1d6+2", tipo: "trevas" }] },
  carnical: { nome: "Carniçal Conjurado", tamanho: "med", for: 3, des: 3, pv: 12, desl: { walk: 9 }, defesa: null,
    danos: [{ formula: "1d8+3", tipo: "trevas" }, { formula: "1d8", tipo: "perda" }],
    condicao: { nome: "Paralisado", status: "paralisado", rodadas: 1 },
    texto: "Mais perda de 1d8 PV por veneno. Fortitude (CD da magia) ou fica paralisado por 1 rodada; quem passa fica imune à paralisia dos carniçais por 24 horas." },
  sombra: { nome: "Sombra Conjurada", tamanho: "med", for: 2, des: 4, pv: 30, desl: { walk: 9 }, defesa: null, incorporeo: true,
    danos: [{ formula: "1d10", tipo: "trevas" }, { formula: "1d10", tipo: "frio" }], perdaPM: "1d4",
    texto: "Criaturas vivas atingidas: Fortitude (CD da magia) ou perdem 1d4 PM. Incorpórea; perde isso exposta à luz do sol." },
  soterrado: { nome: "Soterrado Conjurado", tamanho: "med", for: 2, des: 2, pv: 1, desl: { walk: 9 }, defesa: null,
    danos: [{ formula: "1d6+2", tipo: "frio" }], condicao: { nome: "Enredado", status: "enredado", rodadas: 1 },
    texto: "Fortitude (CD da magia) ou fica enredado por 1 rodada." },
  furia: { nome: "Fúria de Tauron", tamanho: "peq", for: 2, des: 5, pv: 1, desl: { walk: 9, fly: 12 }, defesa: 18, incorporeo: true,
    danos: [{ formula: "1d6", tipo: "trevas" }, { formula: "1d6", tipo: "fogo" }],
    condicao: { nome: "Em Chamas", status: "emchamas", rodadas: 0 },
    texto: "Criaturas vivas atingidas ficam desprevenidas por 1 rodada e em chamas (Fortitude, CD da magia, evita)." },
};

// Variantes só de devotos (Ameaças de Arton), que valem pras duas magias.
MORTOS_VIVOS.guerreiro = { nome: "Guerreiro Perpétuo", tamanho: "med", for: 5, des: 4, pv: 1, desl: { walk: 9 }, defesa: 33, incorporeo: true,
  danos: [{ formula: "3d6", tipo: "impacto" }, { formula: "3d6", tipo: "impacto" }], texto: "Causa o dano duas vezes por ação." };
MORTOS_VIVOS.zumbi = { nome: "Zumbi Peçonha", tamanho: "med", for: 3, des: 1, pv: 1, desl: { walk: 9 }, defesa: 25,
  danos: [{ formula: "1d8+1", tipo: "trevas" }, { formula: "2d6", tipo: "perda" }], condicao: { nome: "Atordoado", status: "atordoado", rodadas: 1 },
  texto: "Mais perda de 2d6 PV por veneno. O atingido fica atordoado por 1 rodada (uma vez por cena) e depois fraco; Fortitude (CD da magia) reduz para fraco por 1 rodada." };

/** Exército dos Mortos (Dragão Brasil): capangas de 1 PV, mas com Defesa; sombra só de trevas. */
export const EXERCITO = Object.fromEntries(Object.entries(MORTOS_VIVOS).map(([k, v]) => [k, { ...v, pv: 1,
  defesa: { esqueleto: 18, carnical: 27, sombra: 35, soterrado: 18, furia: 18, guerreiro: 33, zumbi: 25 }[k] }]));
EXERCITO.sombra = { ...EXERCITO.sombra, danos: [{ formula: "2d10", tipo: "trevas" }] };

export function conjurarMortosVivos(aprs = [], tabela = MORTOS_VIVOS) {
  const tipo = vezes(aprs, "conjura sombras") ? "sombra" : vezes(aprs, "conjura carnicais") ? "carnical"
    : vezes(aprs, "furias de tauron") ? "furia" : vezes(aprs, "conjura soterrados") ? "soterrado"
    : vezes(aprs, "guerreiros perpetuos") ? "guerreiro" : vezes(aprs, "zumbis peconha") ? "zumbi" : "esqueleto";
  return { tipo, quantidade: 6 + vezes(aprs, "aumenta o numero de mortos-vivos"), ...tabela[tipo] };
}

// ─── Enxames ──────────────────────────────────────────────────────────────────
export const TIPOS_FISICOS = ["corte", "impacto", "perfuracao"];
export const TIPOS_ELEMENTAIS = ["acido", "eletricidade", "fogo", "frio"];

/** Enxame de Pestes: 2d12 (maiores 3d12, elementais 5d12) + 1d12 por aprimoramento. */
export function enxamePestes(aprs = [], escolha = {}) {
  const elemental = vezes(aprs, "criaturas elementais") > 0;
  const maiores = !elemental && vezes(aprs, "criaturas maiores") > 0;
  const base = elemental ? 5 : maiores ? 3 : 2;
  const permitidos = elemental ? TIPOS_ELEMENTAIS : maiores ? TIPOS_FISICOS : ["corte"];
  return {
    variante: elemental ? "elemental" : maiores ? "maiores" : "pestes", tamanho: "med", lado: 1,
    quantidade: 1 + vezes(aprs, "aumenta o numero de enxames"),
    formula: `${base + vezes(aprs, "aumenta o dano em +1d12")}d12`,
    tipo: permitidos.includes(escolha.tipo) ? escolha.tipo : permitidos[0], escolhas: permitidos.length > 1 ? permitidos : null,
    teste: elemental || maiores ? "Reflexos" : "Fortitude", desl: { walk: 12, fly: 0 },
  };
}

/** Enxame Rubro de Ichabod: Grande (3m), 4d12 ácido; Enorme é quadrado de 6m. */
export function enxameRubro(aprs = []) {
  const enorme = vezes(aprs, "enxame vira enorme") > 0;
  return {
    tamanho: enorme ? "eno" : "gra", lado: enorme ? 4 : 2, quantidade: 1,
    formula: `${4 + vezes(aprs, "aumenta o dano em +1d12")}d12`,
    tipo: vezes(aprs, "muda o dano para trevas") ? "trevas" : "acido", teste: "Reflexos",
    desl: { walk: 12, fly: vezes(aprs, "deslocamento de voo 18") ? 18 : 0 },
    agarra: vezes(aprs, "fica agarrada") > 0, parasitas: vezes(aprs, "parasitas") > 0,
  };
}

// ─── Animar Objetos ───────────────────────────────────────────────────────────
export const OBJETOS = {
  min: { nome: "Minúsculo", for: -3, des: 4, pv: 5, max: 8, parceiros: "Assassino ou Combatente Iniciante" },
  peq: { nome: "Pequeno", for: -2, des: 2, pv: 10, max: 8, parceiros: "Combatente ou Guardião Iniciante" },
  med: { nome: "Médio", for: 0, des: 1, pv: 20, max: 4, parceiros: "Combatente ou Guardião Veterano" },
  gra: { nome: "Grande", for: 2, des: 0, pv: 40, max: 2, parceiros: "Fortão, Guardião ou Montaria (cavalo) Veterano" },
  eno: { nome: "Enorme", for: 4, des: -2, pv: 60, max: 1, parceiros: "Fortão, Guardião ou Montaria (cavalo) Mestre" },
};
LADO_TOKEN.min = 0.5;

export function animarObjetos(tamanho, quantidade) {
  const o = OBJETOS[tamanho] ?? OBJETOS.med;
  return { tamanho: OBJETOS[tamanho] ? tamanho : "med", ...o, quantidade: Math.max(1, Math.min(o.max, Number(quantidade) || o.max)) };
}

// ─── Parceiros (Aliado Animal, Montaria Arcana, Conjurar Elemental, Servo Morto-Vivo) ──
/** Tipo de parceiro → item do pack tormenta20.parceiros. */
export const ITEM_PARCEIRO = { ajudante: "Ajudante", assassino: "Assassino", atirador: "Atirador", combatente: "Combatente",
  destruidor: "Destruidor", fortao: "Fortão", guardiao: "Guardião", medico: "Médico", montaria: "Montaria: Cavalo",
  perseguidor: "Perseguidor", vigilante: "Vigilante" };
export const NIVEIS = ["iniciante", "veterano", "mestre"];

/** Efeitos do item de parceiro que valem pro nível: os do nível + os que não citam nível nenhum. */
export function efeitosDoNivel(efeitos, nivel) {
  return efeitos.filter((e) => {
    const n = sem(e.name);
    const cita = NIVEIS.filter((x) => n.includes(x));
    return !cita.length || cita.includes(nivel);
  });
}

/** Conserta chave de efeito digitada errada nos packs ("system. attributes", "attibutes", walk sem .base). */
export function consertarChave(chave) {
  let k = String(chave ?? "").replace(/\s+/g, "").replace("attibutes", "attributes");
  if (/movement\.(walk|fly|swim|climb|burrow)$/.test(k)) k += ".base";
  return k;
}

export function aliadoAnimal(aprs = []) {
  return {
    nivel: vezes(aprs, "muda o parceiro para mestre") ? "mestre" : "veterano",
    quantidade: vezes(aprs, "2 animais prestativos") ? 2 : 1,
    mensageiro: vezes(aprs, "animal minusculo") > 0,
    tipos: ["ajudante", "combatente", "fortao", "guardiao", "montaria", "perseguidor"],
  };
}

export function montariaArcana(aprs = []) {
  return {
    nivel: vezes(aprs, "para mestre") ? "mestre" : "veterano",
    permanente: vezes(aprs, "duracao para permanente") > 0,
    categoriasExtras: vezes(aprs, "aumenta o tamanho da montaria"),
    medo: vezes(aprs, "criaturas do tipo animal") > 0,
  };
}

export const ELEMENTOS = {
  ar: { nome: "Ar", de: "do Ar", dano: "eletricidade", tipos: ["assassino", "perseguidor", "vigilante"] },
  agua: { nome: "Água", de: "da Água", dano: "frio", tipos: ["ajudante", "guardiao", "medico"] },
  fogo: { nome: "Fogo", de: "do Fogo", dano: "fogo", tipos: ["atirador", "combatente", "fortao"] },
  terra: { nome: "Terra", de: "da Terra", dano: "impacto", tipos: ["combatente", "guardiao", "montaria"] },
};

export function conjurarElemental(aprs = []) {
  const enorme = vezes(aprs, "muda para enorme") > 0;
  return { nivel: "mestre", tamanho: enorme ? "eno" : "gra", tiposPorElemental: enorme ? 2 : 1, todos: vezes(aprs, "um elemental de cada tipo") > 0 };
}

export const SERVOS = {
  esqueleto: { nome: "Esqueleto ou Zumbi", nivel: "iniciante", tipos: ["ajudante", "atirador", "combatente", "fortao", "guardiao", "montaria"] },
  carnical: { nome: "Carniçal", nivel: "veterano", tipos: ["ajudante", "atirador", "combatente", "fortao", "guardiao"] },
  sombra: { nome: "Sombra", nivel: "veterano", tipos: ["assassino", "combatente", "perseguidor"] },
  mumia: { nome: "Múmia", nivel: "mestre", tipos: ["ajudante", "destruidor", "guardiao", "medico"] },
};

export function servoMortoVivo(aprs = []) {
  const criatura = vezes(aprs, "cria uma mumia") ? "mumia" : vezes(aprs, "cria uma sombra") ? "sombra"
    : vezes(aprs, "cria um carnical") ? "carnical" : "esqueleto";
  return { criatura, ...SERVOS[criatura] };
}

// ─── Servos Invisíveis e Legião ───────────────────────────────────────────────
export const servosInvisiveis = (aprs = []) => ({
  quantidade: 3 + vezes(aprs, "aumenta o numero de servos"), tarefa: vezes(aprs, "realizar uma unica tarefa") > 0,
});

export const legiao = (aprs = []) => ({ alvos: 10 + vezes(aprs, "aumenta o numero de alvos") });

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

  // Conjurar Monstro — textos como estão no compêndio do sistema e no Livro Básico
  const GRANDE = "aumenta o tamanho do monstro para Grande. Ele tem For 7, Des 2, 75 PV, deslocamento 12m e seu ataque causa 4d6+10 pontos de dano com 3m de alcance. Requer 2º círculo.";
  const GRANDE_LIVRO = "aumenta o tamanho do monstro para Grande. Ele tem For 24, Des 14, 75 PV, deslocamento 12m e seu ataque causa 3d6+7 pontos de dano com 3m de alcance.";
  const MEDIO = "aumenta o tamanho do monstro para Médio. Ele tem For 4, Des 3, 45 PV, deslocamento 12m e seu ataque causa 2d6+6 pontos de dano.";
  let m = conjurarMonstro([]);
  assert(m.tamanho === "peq" && m.pv === 20 && m.for === 2 && m.des === 3 && m.desl.walk === 9 && m.ataque.formula === "2d4+2", "monstro base");
  m = conjurarMonstro([e(GRANDE)]);
  assert(m.tamanho === "gra" && m.for === 7 && m.pv === 75 && m.ataque.formula === "4d6+10" && m.ataque.alcance === 3, "Grande do compêndio");
  m = conjurarMonstro([e(GRANDE_LIVRO)]);
  assert(m.for === 7 && m.des === 2 && m.ataque.formula === "3d6+7", "Grande do livro: For 24/Des 14 vira 7/2");
  m = conjurarMonstro([e(MEDIO), e(GRANDE)]);
  assert(m.tamanho === "gra", "o maior tamanho vence");
  m = conjurarMonstro([e(MEDIO), e("aumenta os PV do monstro em +10 para cada categoria de tamanho", 2), e("aumenta o deslocamento do monstro em +3m.", 2)]);
  assert(m.pv === 45 + 2 * 20 && m.desl.walk === 18, "PV +20 por vez no Médio, deslocamento +3m ×2");
  assert(m.ataque.alcance === 1.5, "Médio sem alcance no texto = corpo a corpo");
  m = conjurarMonstro([e("o monstro ganha deslocamento de escalada ou natação igual ao seu deslocamento terrestre."), e("o monstro ganha deslocamento de voo igual ao dobro do deslocamento.")], { escaladaOuNatacao: "swim" });
  assert(m.desl.swim === 9 && m.desl.climb === 0 && m.desl.fly === 18, "natação = terrestre, voo = dobro");
  m = conjurarMonstro([e("muda o tipo de dano do ataque do monstro para ácido, fogo, frio ou eletricidade."), e("o monstro ganha resistência 5 contra dois tipos de dano"), e("o monstro ganha uma nova ordem: Arma de Sopro.")],
    { tipoDano: "fogo", resistencias: ["corte", "frio", "fogo"] });
  assert(m.ataque.tipo === "fogo" && m.resistencias.join() === "corte,frio" && m.sopro && !m.cegas, "tipo elemental, só 2 resistências, sopro");
  assert(conjurarMonstro([], { resistencias: ["corte"] }).resistencias.length === 0, "resistência só com o aprimoramento");
  const p = perguntasMonstro([e("muda o tipo de dano do ataque do monstro"), e("imunidade contra dois tipos de dano")]);
  assert(p.elemental && p.imunidades && !p.resistencias && !p.escaladaOuNatacao, "perguntas só do que foi marcado");

  // Conjurar Mortos-Vivos
  let mv = conjurarMortosVivos([]);
  assert(mv.tipo === "esqueleto" && mv.quantidade === 6 && mv.pv === 1 && mv.danos[0].formula === "1d6+2", "6 esqueletos");
  mv = conjurarMortosVivos([e("aumenta o número de mortos-vivos conjurados em +1.", 3), e("em vez de esqueletos, conjura carniçais. Requer 3º círculo.")]);
  assert(mv.tipo === "carnical" && mv.quantidade === 9 && mv.pv === 12 && mv.danos[0].formula === "1d8+3", "9 carniçais (livro: 12 PV, 1d8+3)");
  mv = conjurarMortosVivos([e("em vez de esqueletos, conjura sombras. Requer 4º círculo.")]);
  assert(mv.tipo === "sombra" && mv.pv === 30 && mv.incorporeo && mv.danos.map((d) => d.tipo).join() === "trevas,frio", "sombra (livro: 30 PV, trevas + frio)");
  assert(conjurarMortosVivos([e("Em vez de esqueletos, conjura fúrias de Tauron.")]).defesa === 18, "fúria de Tauron (AdA)");
  mv = conjurarMortosVivos([e("em vez de esqueletos, conjura guerreiros perpétuos")]);
  assert(mv.tipo === "guerreiro" && mv.defesa === 33 && mv.danos.length === 2, "guerreiro perpétuo (AdA): dano duas vezes");
  mv = conjurarMortosVivos([e("em vez de esqueletos, conjura sombras.")], EXERCITO);
  assert(mv.pv === 1 && mv.defesa === 35 && mv.danos.length === 1 && mv.danos[0].formula === "2d10", "Exército dos Mortos: sombra capanga");
  assert(conjurarMortosVivos([], EXERCITO).defesa === 18, "Exército: esqueleto com Defesa 18");

  // Enxames
  let x = enxamePestes([e("aumenta o dano em +1d12.", 2)]);
  assert(x.formula === "4d12" && x.tipo === "corte" && x.teste === "Fortitude" && x.quantidade === 1 && !x.escolhas, "pestes 2d12 +2");
  x = enxamePestes([e("muda a resistência para Reflexos reduz à metade e o enxame para criaturas maiores, como gatos"), e("aumenta o número de enxames em +1.", 2)], { tipo: "impacto" });
  assert(x.formula === "3d12" && x.tipo === "impacto" && x.teste === "Reflexos" && x.quantidade === 3, "maiores 3d12, 3 enxames");
  x = enxamePestes([e("muda a resistência para Reflexos reduz à metade e o enxame para criaturas elementais.")], { tipo: "corte" });
  assert(x.formula === "5d12" && x.tipo === "acido" && x.escolhas.length === 4, "elemental 5d12 não aceita corte");
  x = enxameRubro([e("o enxame vira Enorme (quadrado de 6m de lado)."), e("muda o dano para trevas."), e("o enxame ganha deslocamento de voo 18m")]);
  assert(x.tamanho === "eno" && x.lado === 4 && x.tipo === "trevas" && x.desl.fly === 18 && x.formula === "4d12", "rubro enorme de trevas voando");

  // Animar Objetos
  let o = animarObjetos("gra", 5);
  assert(o.quantidade === 2 && o.for === 2 && o.pv === 40, "até 2 Grandes");
  assert(animarObjetos("min").quantidade === 8 && LADO_TOKEN.min === 0.5, "8 minúsculos de meio quadrado");

  // Parceiros
  const efs = ["Combatente Iniciante", "Combatente Veterano", "Combatente Mestre", "Combatente Mestre: Ataque extra", "Ajudante"].map((name) => ({ name }));
  assert(efeitosDoNivel(efs, "mestre").map((x) => x.name).join() === "Combatente Mestre,Combatente Mestre: Ataque extra,Ajudante", "efeitos do nível + genéricos");
  assert(efeitosDoNivel([{ name: "Gorlogg iniciante: +1d6" }], "veterano").length === 0, "nível em minúscula também conta");
  assert(consertarChave("system. attributes.movement.walk") === "system.attributes.movement.walk.base", "chave do Cavalo Iniciante");
  assert(consertarChave("system.attibutes.movement.walk") === "system.attributes.movement.walk.base", "attibutes");
  assert(consertarChave("system.attributes.defesa.bonus") === "system.attributes.defesa.bonus", "chave boa fica");
  let pa = aliadoAnimal([e("muda o parceiro para mestre. Requer 3º círculo."), e("muda o alvo para 2 animais prestativos. Cada animal")]);
  assert(pa.nivel === "mestre" && pa.quantidade === 2 && !pa.mensageiro, "aliado animal mestre ×2");
  assert(aliadoAnimal([]).nivel === "veterano", "aliado animal veterano");
  assert(montariaArcana([e("muda o nível do aliado para mestre. Requer 3º círculo.")]).nivel === "mestre", "montaria mestre");
  let ce = conjurarElemental([e("o elemental muda para Enorme e recebe dois tipos de aliado indicados no seu elemento.")]);
  assert(ce.tamanho === "eno" && ce.tiposPorElemental === 2 && !ce.todos, "elemental enorme com 2 tipos");
  assert(servoMortoVivo([e("muda o componente material para pó de ônix negro (T$ 500). Em vez de um zumbi ou esqueleto, cria uma sombra.")]).nivel === "veterano", "servo sombra veterano");
  assert(servoMortoVivo([e("Em vez de um zumbi ou esqueleto, cria uma múmia.")]).tipos.includes("destruidor"), "múmia mestre pode destruidor");
  assert(servosInvisiveis([e("aumenta o número de servos conjurados em 1.", 2)]).quantidade === 5, "5 servos");
  assert(legiao([e("aumenta o número de alvos em +1.", 3)]).alvos === 13, "legião 13 alvos");
  console.log("regras.mjs: 53 casos OK");
}
