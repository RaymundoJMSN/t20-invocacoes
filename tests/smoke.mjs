// Smoke do fluxo inteiro com o Foundry fingido: card da magia no chat → escolhas → ficha → ator
// criado a partir do molde REAL do compêndio "convocacoes" (tests/moldes-convocacoes.json, extraído
// do pack do sistema) com o mergeObject de verdade do Foundry. node tests/smoke.mjs
import fs from "node:fs";
import { mergeObject } from "file:///X:/FoundryVTT/Code/resources/app/common/utils/helpers.mjs";

const moldes = JSON.parse(fs.readFileSync(new URL("./moldes-convocacoes.json", import.meta.url), "utf8"));
const ok = (c, m) => { if (!c) { console.error(`FALHOU: ${m}`); process.exit(1); } };
const hooks = {};
const lista = (arr) => Object.assign(arr, { getName: (n) => arr.find((x) => x.name === n) });

// ── ator fingido: guarda os dados e "calcula" Defesa e Reflexos do jeito do sistema (base + algo) ──
const atores = lista([]);
class AtorFalso {
  constructor(dados) { Object.assign(this, structuredClone(dados)); this.id = `a${atores.length}`; this.recalcular(); }
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

const cena = { id: "c1", tokens: [], async deleteEmbeddedDocuments(_t, ids) { this.tokens = this.tokens.filter((t) => !ids.includes(t.id)); },
  async createEmbeddedDocuments(_t, dados) { dados.forEach((d, i) => this.tokens.push({ ...d, id: `t${this.tokens.length + i}` })); } };
let escolha = null, cliques = 0;

Object.assign(globalThis, {
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1, OWNER: 3 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 }, TOKEN_DISPLAY_MODES: { OWNER_HOVER: 20 } },
  CONFIG: { T20: { damageTypes: { dano: "x", perda: "x", corte: "corte", impacto: "impacto", perfuracao: "perfuração", fogo: "fogo", frio: "frio", trevas: "trevas", acido: "ácido", eletricidade: "eletricidade" } } },
  foundry: { utils: { mergeObject, deepClone: structuredClone }, applications: { api: { DialogV2: { prompt: async () => escolha } } } },
  Actor: { create: async (d) => { const a = new AtorFalso(d); atores.push(a); return a; } },
  Folder: { create: async (d) => ({ id: "pasta", ...d, getFlag: () => true }) },
  Sequencer: { Crosshair: { show: async () => ({ x: 100 * ++cliques, y: 50 }) } },
  Sequence: class { sound() { return this; } effect() { return this; } atLocation() { return this; } scale() { return this; } play() {} },
  canvas: { scene: { id: "c1" }, tokens: { get: () => null }, grid: { getTopLeftPoint: (p) => p, getCenterPoint: (p) => p } },
});
globalThis.game = {
  user: { id: "u1" }, actors: atores, scenes: Object.assign([cena], { get: () => cena }),
  folders: { find: () => null }, i18n: { localize: (s) => s },
  packs: { get: () => ({ getDocuments: async ({ name }) => (moldes[name] ? [{ toObject: () => structuredClone(moldes[name]) }] : []) }) },
  socket: { on() {}, emit() {} },
};
game.users = { activeGM: game.user };
game.user.isGM = true;

const conjurador = {
  id: "bruxa", name: "Bruxa", type: "character", getActiveTokens: () => [],
  system: { attributes: { nivel: { value: 8 }, conjuracao: "int" }, atributos: { int: { value: 4 } }, pericias: { refl: { value: 7 } } },
};
const magia = (name) => ({ name, system: { resistencia: {} } });
conjurador.items = { get: (id) => magia(id) };
globalThis.ChatMessage = { getSpeakerActor: () => conjurador };

await import("../scripts/main.mjs");
const lancar = (nome, aprs) => Promise.all(hooks.createChatMessage.map((f) => f({
  flags: { tormenta20: { itemData: {}, onUseEffects: aprs } }, content: `<div data-item-id="${nome}">`, speaker: {}, rolls: [],
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

// ── 0 PV some do mapa ──
let apagado = false;
hooks.updateActor[0]({ isToken: true, getFlag: () => "x", system: { attributes: { pv: { value: 0 } } }, token: { delete: () => (apagado = true) } });
ok(apagado, "criatura conjurada a 0 PV some");

console.log("smoke OK (25 checagens)");
