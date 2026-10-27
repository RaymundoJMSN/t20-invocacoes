// Smoke do fluxo inteiro com o Foundry fingido: card da magia no chat → escolhas → ficha → ator
// criado a partir do molde REAL do compêndio "convocacoes" e itens REAIS do pack "parceiros"
// (tests/*.json, extraídos dos packs do sistema, sem textos) com o mergeObject de verdade do Foundry.
//   node tests/smoke.mjs
import fs from "node:fs";
import { mergeObject } from "file:///X:/FoundryVTT/Code/resources/app/common/utils/helpers.mjs";

const ler = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const moldes = ler("./moldes-convocacoes.json"), parceiros = ler("./parceiros.json");
let checagens = 0;
const ok = (c, m) => { checagens++; if (!c) { console.error(`FALHOU: ${m}`); process.exit(1); } };
const hooks = {};
const lista = (arr) => Object.assign(arr, { getName: (n) => arr.find((x) => x.name === n) });
let seq = 0;

/** Documento embutido fingido (item/efeito) com getFlag, uuid e delete. */
function embutido(dados, dono, colecao) {
  const d = Object.assign(structuredClone(dados), { id: `e${++seq}` });
  d.uuid = `${dono.uuid}.X.${d.id}`;
  d.getFlag = (escopo, k) => d.flags?.[escopo]?.[k];
  d.delete = async () => { const i = dono[colecao].indexOf(d); if (i >= 0) dono[colecao].splice(i, 1); };
  return d;
}
/** Mistura pra ficha: itens e efeitos embutidos. */
function comEmbutidos(alvo) {
  alvo.items = Object.assign(alvo.items ?? [], { get: alvo.items?.get });
  alvo.effects ??= [];
  alvo.createEmbeddedDocuments = async (tipo, dados) => {
    const col = tipo === "Item" ? "items" : "effects";
    const novos = dados.map((x) => embutido(x, alvo, col));
    alvo[col].push(...novos);
    // legado do sistema: efeito "transfer" do item vai pra ficha com origin = item
    if (tipo === "Item") for (const it of novos) for (const ef of it.effects ?? []) if (ef.transfer) alvo.effects.push(embutido({ ...ef, origin: it.uuid }, alvo, "effects"));
    return novos;
  };
  alvo.deleteEmbeddedDocuments = async (tipo, ids) => {
    const col = tipo === "Item" ? "items" : "effects";
    for (const id of ids) { const i = alvo[col].findIndex((x) => x.id === id); if (i >= 0) alvo[col].splice(i, 1); }
  };
  return alvo;
}

// ── ator fingido: guarda os dados e "calcula" Defesa e Reflexos do jeito do sistema (base + algo) ──
const atores = lista([]);
class AtorFalso {
  constructor(dados) {
    Object.assign(this, structuredClone(dados)); this.id = `a${atores.length}`; this.uuid = `Actor.${this.id}`;
    for (const it of this.items ?? []) it.getFlag = (escopo, k) => it.flags?.[escopo]?.[k];
    this.recalcular();
  }
  recalcular() {   // o sistema soma coisas que a gente não controla: simula +3 na Defesa e +1 no Reflexos
    this.system.attributes.defesa.value = Number(this.system.attributes.defesa.base) + 3;
    this.system.pericias.refl.value = Number(this.system.pericias.refl.outros) + 1;
  }
  getFlag(escopo, k) { return this.flags?.[escopo]?.[k]; }
  async update(mud) {
    for (const [k, v] of Object.entries(mud)) k.split(".").reduce((o, p, i, a) => (i === a.length - 1 ? (o[p] = v) : o[p]), this);
    this.recalcular();
  }
  async delete() { atores.splice(atores.indexOf(this), 1); }
  async getTokenDocument(p) { return { toObject: () => ({ ...this.prototypeToken, ...p, actorId: this.id }) }; }
}

const cena = { id: "c1", tokens: Object.assign([], { contents: [] }),
  async deleteEmbeddedDocuments(_t, ids) { for (let i = this.tokens.length - 1; i >= 0; i--) if (ids.includes(this.tokens[i].id)) this.tokens.splice(i, 1); },
  async createEmbeddedDocuments(_t, dados) { dados.forEach((d, i) => this.tokens.push({ ...d, id: `t${this.tokens.length + i}` })); } };
let escolha = null, cliques = 0;
const mensagens = [];

const pacote = (fonte) => ({
  getDocuments: async ({ name }) => (fonte[name] ? [{ toObject: () => structuredClone(fonte[name]) }] : []),
  index: Object.keys(fonte).map((name) => ({ name })),
});
Object.assign(globalThis, {
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OWNER: 3 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 }, TOKEN_DISPLAY_MODES: { OWNER_HOVER: 20 } },
  CONFIG: { T20: { damageTypes: { dano: "x", perda: "x", corte: "corte", impacto: "impacto", perfuracao: "perfuração", fogo: "fogo", frio: "frio", trevas: "trevas", acido: "ácido", eletricidade: "eletricidade" } } },
  foundry: { utils: { mergeObject, deepClone: structuredClone }, applications: { api: { DialogV2: { prompt: async () => escolha } } } },
  Actor: { create: async (d) => { const a = new AtorFalso(d); atores.push(a); return a; } },
  Folder: { create: async (d) => ({ id: "pasta", ...d, getFlag: () => true }) },
  Sequencer: { Crosshair: { show: async () => ({ x: 100 * ++cliques, y: 50 }) } },
  Sequence: class { sound() { return this; } effect() { return this; } atLocation() { return this; } scale() { return this; } play() {} },
  canvas: { scene: { id: "c1" }, tokens: { get: () => null, placeables: [] }, grid: { getTopLeftPoint: (p) => p, getCenterPoint: (p) => p } },
  ui: { notifications: { info: () => {}, warn: (m) => console.warn("aviso:", m), error: (m) => console.warn("erro:", m) } },
});
const conjurador = comEmbutidos({
  id: "bruxa", uuid: "Actor.bruxa", name: "Bruxa", type: "character", getActiveTokens: () => [], getFlag: () => undefined,
  system: { attributes: { nivel: { value: 8 }, conjuracao: "int" }, atributos: { int: { value: 4 } }, pericias: { refl: { value: 7 } } },
  items: Object.assign([], { get: (id) => ({ name: id, system: { resistencia: {} } }) }),
});
// o token que a Legião domina
const orc = comEmbutidos({ id: "orc", uuid: "Actor.orc", name: "Orc", ownership: { default: 0 }, rollPericia: async () => ({ rolls: [{ total: 30 }] }) });
const tokenOrc = { name: "Orc", actorLink: false, actor: orc, uuid: "Scene.c1.Token.orc", atualizacoes: [], async update(u) { this.atualizacoes.push(u); } };
cena.tokens.contents = [tokenOrc];

globalThis.game = {
  user: { id: "u1", isGM: true, targets: new Set() }, scenes: Object.assign([cena], { get: () => cena, contents: [cena] }),
  // as invocações (atores) + as fichas de jogador que recebem parceiro
  actors: { filter: (f) => [...atores, conjurador].filter(f), find: (f) => [...atores, conjurador].find(f), [Symbol.iterator]: () => [...atores, conjurador][Symbol.iterator]() },
  folders: { find: () => null }, i18n: { localize: (s) => s },
  packs: { get: (id) => (id === "tormenta20.parceiros" ? pacote(parceiros) : pacote(moldes)) },
  socket: { on() {}, emit() {} }, settings: { get: () => "default" },
};
game.users = { activeGM: game.user };
globalThis.fromUuid = async (u) => ({ "Actor.bruxa": conjurador, "Scene.c1.Token.orc": tokenOrc }[u] ?? null);
globalThis.ChatMessage = { getSpeakerActor: () => conjurador, create: async (d) => mensagens.push(d) };

await import("../scripts/main.mjs");
const lancar = (nome, aprs, extra = {}) => Promise.all(hooks.createChatMessage.map((f) => f({
  flags: { tormenta20: { itemData: {}, onUseEffects: aprs } }, content: `<div data-item-id="${nome}">`, speaker: {}, rolls: [], ...extra,
}, {}, "u1")));
const e = (description, qty = 1) => ({ description, qty });

// ── Conjurar Monstro Grande com sopro e resistência ──
escolha = { tipoDano: "impacto", resistencias: ["fogo", "frio"], imunidades: [] };
await lancar("Conjurar Monstro", [
  e("aumenta o tamanho do monstro para Grande. Ele tem For 7, Des 2, 75 PV, deslocamento 12m e seu ataque causa 4d6+10 pontos de dano com 3m de alcance. Requer 2º círculo."),
  e("o monstro ganha uma nova ordem: Arma de Sopro."), e("o monstro ganha resistência 5 contra dois tipos de dano"),
]);
ok(atores.length === 1, "um ator criado");
let a = atores[0];
ok(a.name === "Monstro de Bruxa" && a.type === "simple", "nome e tipo simple do molde");
ok(a.system.attributes.pv.max === 75 && a.system.tracos.tamanho === "gra" && a.prototypeToken.width === 2, "Grande: 75 PV, token 2×2");
ok(a.system.atributos.for.base === 7 && a.system.atributos.des.base === 2 && a.system.atributos.con.base === 0, "atributos na base (o molde tinha -2/-4)");
ok(a.items.map((i) => i.name).join() === "Atacar,Arma de Sopro", "só as ordens da regra (sem itens do molde)");
ok(JSON.stringify(a.items[0].system.rolls[0].parts) === '[["4d6+10","impacto",""]]', "ataque com o dano do texto e o tipo escolhido");
ok(a.items[1].system.rolls[0].parts[0][0] === "(4d6+10)*2" && a.items[1].system.area === "Cone 6m", "sopro = dobro em cone de 6m");
ok(a.items[1].system.resistencia.txt.includes("CD 18"), "CD = 10 + ½ nível (4) + Int (4)");
ok(a.system.tracos.resistencias.fogo.base === 5 && a.system.tracos.resistencias.frio.base === 5, "resistência 5 nos tipos escolhidos");
ok(a.system.attributes.defesa.value === 0, "sem Defesa: acertada pela diferença");
ok(a.system.pericias.refl.value === 7, "Reflexos do conjurador");
ok(a.ownership.u1 === 3 && a.flags["t20-invocacoes"].chave === "bruxa:Conjurar Monstro", "posse e chave");
ok(cena.tokens.length === 1 && cena.tokens[0].disposition === 1, "um token amigo");

// ── conjurar de novo: o anterior some ──
escolha = { tipoDano: "corte" };
await lancar("Conjurar Monstro", []);
ok(atores.length === 1 && cena.tokens.length === 1, "só um monstro por vez");
a = atores[0];
ok(a.system.tracos.tamanho === "peq" && a.system.attributes.pv.max === 20 && a.items.length === 1, "monstro base Pequeno sem sopro");

// ── Conjurar Mortos-Vivos: 7 sombras ──
cliques = 0;
await lancar("Conjurar Mortos-Vivos", [e("aumenta o número de mortos-vivos conjurados em +1."), e("em vez de esqueletos, conjura sombras. Requer 4º círculo.")]);
const sombra = atores.find((x) => x.name.startsWith("Sombra"));
ok(sombra && cena.tokens.filter((t) => t.actorId === sombra.id).length === 7, "7 sombras no mapa");
ok(sombra.system.attributes.pv.max === 30, "sombra com 30 PV (o compêndio diz 1)");
ok(JSON.stringify(sombra.items[0].system.rolls[0].parts) === '[["1d10","trevas",""],["1d10","frio",""]]', "trevas + frio");
ok(sombra.system.tracos.ic.value.includes("paralisado") && sombra.system.tracos.ic.custom.includes("incorpóreo"), "imunidades do molde + incorpóreo");
ok(atores.length === 2, "monstro e sombras convivem (magias diferentes)");

// ── Enxame de Pestes de criaturas maiores ──
escolha = { tipo: "impacto" };
await lancar("Enxame de Pestes", [e("muda a resistência para Reflexos reduz à metade e o enxame para criaturas maiores, como gatos"), e("aumenta o dano em +1d12.")]);
const enx = atores.find((x) => x.name.startsWith("Enxame"));
ok(enx && enx.system.attributes.pv.max === 0 && enx.system.attributes.movement.walk === 12, "enxame sem PV, desloca 12m");
ok(JSON.stringify(enx.items[0].system.rolls[0].parts) === '[["4d12","impacto",""]]' && enx.items[0].system.resistencia.txt.startsWith("Reflexos"), "4d12 de impacto, Reflexos");

// ── 0 PV some do mapa; enxame (sem PV) não ──
let apagado = false;
const mexe = (max) => hooks.updateActor[0]({ isToken: true, getFlag: () => "x", system: { attributes: { pv: { value: 0, max } } }, token: { delete: () => (apagado = true) } });
mexe(0);
ok(!apagado, "enxame sem PV fica no mapa");
mexe(1);
ok(apagado, "criatura conjurada a 0 PV some");

// ── Montaria Arcana: parceiro só com o nível veterano, chave do Cavalo consertada ──
await lancar("Montaria Arcana", []);
let mont = conjurador.items.find((i) => i.name === "Montaria Arcana");
ok(mont && mont.effects.every((ef) => /veterano/i.test(ef.name)), "só efeitos do nível veterano");
ok(mont.effects.length >= 1 && mont.system.description.value.includes("Parceiro Veterano"), "nível na descrição");
await lancar("Montaria Arcana", [e("muda o nível do aliado para mestre. Requer 3º círculo.")]);
const montarias = conjurador.items.filter((i) => i.name === "Montaria Arcana");
ok(montarias.length === 1 && montarias[0].effects.every((ef) => /mestre/i.test(ef.name)), "reconjurar troca pelo mestre");
ok(montarias[0].effects.every((ef) => ef.changes.every((c) => !/\s|attibutes/.test(c.key))), "chaves consertadas");

// ── Conjurar Elemental do fogo como fortão: destruidor + fortão, os dois mestres ──
escolha = { elemento: "fogo", x1: "fortao" };
await lancar("Conjurar Elemental", []);
const elem = conjurador.items.filter((i) => i.name.startsWith("Elemental do Fogo"));
ok(elem.map((i) => i.name).sort().join() === "Elemental do Fogo: Destruidor,Elemental do Fogo: Fortão", "destruidor + fortão");
ok(elem.find((i) => i.name.endsWith("Fortão")).effects.every((ef) => /mestre/i.test(ef.name)), "fortão mestre");
const fortaoTransferidos = conjurador.effects.filter((ef) => ef.origin === elem.find((i) => i.name.endsWith("Fortão")).uuid);
escolha = { elemento: "terra", x1: "guardiao" };
await lancar("Conjurar Elemental", []);
ok(!conjurador.items.some((i) => i.name.startsWith("Elemental do Fogo")) && conjurador.items.some((i) => i.name === "Elemental da Terra: Guardião"), "elemental novo substitui o antigo");
ok(fortaoTransferidos.every((ef) => !conjurador.effects.includes(ef)), "efeitos passados pra ficha somem junto");
escolha = { elemento: "fogo", x1: "guardiao" };
await lancar("Conjurar Elemental", []);
ok(conjurador.items.some((i) => i.name === "Elemental da Terra: Guardião"), "tipo fora do elemento é recusado (nada muda)");

// ── Servos Invisíveis: 4 bônus de +2 que somem ao serem usados ──
await lancar("Servos Invisíveis", [e("aumenta o número de servos conjurados em 1.")]);
const servos = () => conjurador.effects.filter((ef) => ef.getFlag("t20-invocacoes", "servo"));
ok(servos().length === 4 && servos().every((s) => s.disabled && s.flags.tormenta20.skill), "4 servos desligados no diálogo de perícia");
await lancar("teste de Atletismo", [e("Servo Invisível", 1)]);
ok(servos().length === 3, "usar um servo gasta um");

// ── Legião: domina o alvo, dá posse, e libera quando ele passa na Vontade ──
game.user.targets = new Set([{ document: { uuid: "Scene.c1.Token.orc" } }]);
await lancar("Legião", []);
ok(orc.effects.some((ef) => ef.name === "Dominado (Legião)" && ef.getFlag("t20-invocacoes", "legiao").cd === 18), "orc dominado com a CD");
ok(tokenOrc.atualizacoes.at(-1)?.delta?.ownership?.u1 === 3, "conjurador ganha posse do token");
await hooks.combatTurnChange[0]({ combatants: { get: () => ({ token: tokenOrc }) } }, { combatantId: "x" });
ok(!orc.effects.some((ef) => ef.name === "Dominado (Legião)") && orc.effects.some((ef) => ef.name === "Abalado"), "passou na Vontade: livre e abalado");
ok(tokenOrc.atualizacoes.at(-1)?.delta?.ownership?.u1 === 0, "posse devolvida");

console.log(`smoke OK (${checagens} checagens)`);
