// t20-invocacoes — magias de invocação automatizadas (Tormenta20, Foundry v13).
// Fluxo: card da magia no chat → lê aprimoramentos → jogador clica os lugares →
// GM (via socket) cria os tokens já ajustados e dá posse ao conjurador.
import {
  espiritoBalistico, circuloPorNivel, formulaDoRoll,
  conjurarMonstro, perguntasMonstro, conjurarMortosVivos, LADO_TOKEN,
} from "./regras.mjs";

const ID = "t20-invocacoes";
const SOCKET = `module.${ID}`;

// ─── Registro: nome da magia → função que monta o pedido de invocação ─────────
const INVOCACOES = {
  "Espírito Balístico": async ({ msg, actor, casterToken }) => {
    const aprs = msg.flags.tormenta20.onUseEffects ?? [];
    // ponytail: círculo máximo ≈ maior entre (círculo pelo nível, conjurador completo) e (maior magia da ficha)
    const circuloMax = Math.max(circuloPorNivel(actor.system.attributes.nivel?.value),
      ...actor.itemTypes.magia.map((m) => Number(m.system.circulo) || 1));
    let tipoElemental = "";
    if (aprs.some((e) => (e.description ?? "").startsWith("(Apenas Golem"))) {
      tipoElemental = await escolherTipoDano();
      if (!tipoElemental) return;
    }
    const r = espiritoBalistico(aprs, { circuloMax, tipoElemental });
    // A rolagem de dano do card já traz tudo que o conjurador soma (Arcano de Batalha,
    // modificadores.dano.mag, aprimoramentos) → o projétil herda essa fórmula.
    const rolada = msg.rolls.find((x) => x.options?.type === "damage");
    const formula = (rolada && formulaDoRoll(rolada.terms)) ?? r.formula;
    console.log(`${ID} | aprimoramentos`, aprs, "→", r, "fórmula do card:", rolada?.formula, "→", formula);
    const posicoes = await escolherPosicoes(r.quantidade, casterToken, 9, "Espírito");
    if (!posicoes.length) return;
    animar(posicoes);
    return {
      atorBase: "Espírito Balístico",
      posicoes,
      disposition: casterToken?.document.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      atualizarAtor: { "system.attributes.defesa.base": actor.system.attributes.defesa.value },
      dano: { formula, tipo: r.tipo },
    };
  },

  // A ficha inteira sai das regras (tamanho, PV, deslocamentos, resistências, ordens); o ator do
  // compêndio "convocacoes" do sistema só dá o molde (tipo simple, imagem) — os números dele têm erro.
  "Conjurar Monstro": async ({ msg, actor, item, casterToken }) => {
    const aprs = msg.flags.tormenta20.onUseEffects ?? [];
    const escolhas = await escolhasDoMonstro(perguntasMonstro(aprs));
    if (!escolhas) return;
    const m = conjurarMonstro(aprs, escolhas);
    const posicoes = await escolherPosicoes(1, casterToken, 9, "Monstro");
    if (!posicoes.length) return;
    animar(posicoes);
    return pedidoDeFicha(fichaDoMonstro(m, { cd: cdDaMagia(actor, item), conjurador: actor }), { actor, item, casterToken, posicoes });
  },

  "Conjurar Mortos-Vivos": async ({ msg, actor, item, casterToken }) => {
    const mv = conjurarMortosVivos(msg.flags.tormenta20.onUseEffects ?? []);
    const posicoes = await escolherPosicoes(mv.quantidade, casterToken, 9, mv.nome);
    if (!posicoes.length) return;
    animar(posicoes);
    return pedidoDeFicha(fichaDoMortoVivo(mv, { cd: cdDaMagia(actor, item), conjurador: actor }), { actor, item, casterToken, posicoes });
  },
};

// ─── Ficha das criaturas (lado do jogador; o GM só cria) ──────────────────────
const LETRA_TAMANHO = { peq: "P", med: "M", gra: "G", eno: "E", col: "C" };
const DESCARTA_FORT_VONT = "Testes de Fortitude e Vontade";

/** CD da magia como o sistema calcula (10 + ½ nível + atributo); magia sem teste fica com cd 0 no item. */
function cdDaMagia(actor, item) {
  const pronta = Number(item.system.resistencia?.cd);
  if (pronta) return pronta;
  if (actor.type === "npc") return Number(actor.system.attributes.cd) || 10;
  const atr = item.system.resistencia?.atributo || actor.system.attributes?.conjuracao;
  return 10 + Math.floor((Number(actor.system.attributes.nivel?.value) || 0) / 2) + (Number(actor.system.atributos?.[atr]?.value) || 0);
}

const rotuloDano = (k) => game.i18n.localize(CONFIG.T20.damageTypes[k] ?? k).toLowerCase();

/** Item "poder" de uma ordem: só dano (os ataques dessas criaturas acertam sem rolar). */
function ordem(nome, desc, danos, { area = "", res = "", rolls = [], efeitos = [] } = {}) {
  return {
    name: nome, type: "poder", img: "icons/svg/sword.svg",
    system: {
      description: { value: `<p>${desc}</p>` }, tipo: "ability",
      ativacao: { execucao: "action", custo: 0, qtd: "", condicao: "", special: "" },
      alcance: "touch", area, resistencia: { pericia: "", atributo: "", bonus: 0, txt: res },
      rolls: [
        ...(danos.length ? [{ name: "Dano", key: "dano0", type: "dano", parts: danos.map((d) => [d.formula, d.tipo, ""]), versatil: "" }] : []),
        ...rolls,
      ],
    },
    effects: efeitos,
  };
}

/** Atributos de criatura conjurada: só For e Des, o resto nulo (0 na ficha). */
const atributos = (f, d) => Object.fromEntries(["for", "des", "con", "int", "sab", "car"]
  .map((k) => [k, { base: k === "for" ? f : k === "des" ? d : 0, racial: 0, bonus: 0 }]));

function fichaDoMonstro(m, { cd, conjurador }) {
  const tipo = rotuloDano(m.ataque.tipo);
  const alcance = m.ataque.alcance > 1.5 ? ` com ${String(m.ataque.alcance).replace(".", ",")}m de alcance` : "";
  const itens = [ordem("Atacar", `Ordem (ação padrão do conjurador): ataca um alvo em alcance corpo a corpo${alcance}. Acerta automaticamente.`,
    [{ formula: m.ataque.formula, tipo: m.ataque.tipo }])];
  if (m.sopro) {
    itens.push(ordem("Arma de Sopro", `Ordem: o dobro do dano de ataque num cone de 6m a partir do monstro (Reflexos CD ${cd} reduz à metade).`,
      [{ formula: `(${m.ataque.formula})*2`, tipo: m.ataque.tipo }], { area: "Cone 6m", res: `Reflexos reduz à metade (CD ${cd})` }));
  }
  const resistencias = {};
  for (const k of m.resistencias) resistencias[k] = { base: 5 };
  for (const k of m.imunidades) resistencias[k] = { ...(resistencias[k] ?? {}), imunidade: true };
  const bio = [
    `Construto de energia conjurado por ${conjurador.name}. Some com um brilho quando é destruído ou a magia acaba.`,
    "Não age sem ordem. Ordens (ação padrão do conjurador): <b>Mover</b> (o dobro do deslocamento), <b>Atacar</b>"
      + (m.sopro ? ", <b>Arma de Sopro</b>" : "") + " e <b>Lançar Magia</b> (serve de ponto de origem pra uma magia do conjurador de ação padrão ou menor).",
    "Pode fazer uma ação de movimento por rodada. Não tem Defesa (ataques contra ele acertam automaticamente) e usa o Reflexos do conjurador.",
    `Dano do ataque: ${m.ataque.formula} de ${tipo}.`,
  ];
  return {
    molde: `Monstro Conjurado (${LETRA_TAMANHO[m.tamanho]})`, nome: `Monstro de ${conjurador.name}`, lado: LADO_TOKEN[m.tamanho],
    system: {
      atributos: atributos(m.for, m.des),
      attributes: {
        pv: { value: m.pv, max: m.pv },
        movement: { ...m.desl, burrow: 0, hover: false, unit: "m" },
        sentidos: { value: m.cegas ? ["cegas"] : [], custom: m.cegas ? "percepção às cegas (alcance curto)" : "" },
      },
      tracos: { tamanho: m.tamanho, ic: { value: [], custom: DESCARTA_FORT_VONT }, resistencias },
      detalhes: { biography: { value: bio.map((p) => `<p>${p}</p>`).join("") } },
    },
    itens,
    ajustes: { defesa: 0, refl: Number(conjurador.system.pericias?.refl?.value) || 0 },
  };
}

function fichaDoMortoVivo(mv, { cd, conjurador }) {
  const efeitos = mv.condicao ? [{
    name: mv.condicao.nome, img: "icons/svg/daze.svg", statuses: [mv.condicao.status], transfer: false, disabled: false, changes: [],
    duration: mv.condicao.rodadas ? { rounds: mv.condicao.rodadas } : {}, flags: { tormenta20: { onuse: false } },
  }] : [];
  const rolls = mv.perdaPM ? [{ name: "PM perdidos", key: "pm1", type: "dano", parts: [[`-${mv.perdaPM}`, "curapm", ""]], versatil: "" }] : [];
  const danoTexto = mv.danos.map((d) => `${d.formula} ${d.tipo === "perda" ? "de perda de PV" : `de ${rotuloDano(d.tipo)}`}`).join(" + ");
  const texto = mv.texto ? ` ${mv.texto.replace(/CD da magia/g, `CD ${cd}`)}` : "";
  const molde = { esqueleto: "Esqueleto Conjurado", carnical: "Carniçal Conjurado", sombra: "Sombra Conjurada" }[mv.tipo] ?? "Esqueleto Conjurado";
  return {
    molde, nome: `${mv.nome} de ${conjurador.name}`, lado: LADO_TOKEN[mv.tamanho],
    system: {
      atributos: atributos(mv.for, mv.des),
      attributes: { pv: { value: mv.pv, max: mv.pv }, movement: { walk: 9, climb: 0, swim: 0, fly: 0, burrow: 0, hover: false, unit: "m", ...mv.desl } },
      tracos: {
        tamanho: mv.tamanho,
        ic: { custom: ["dano não letal, ilusão e sono", mv.incorporeo && "incorpóreo"].filter(Boolean).join("; ") },
      },
      detalhes: { biography: { value: `<p>Conjurado por ${conjurador.name} com energia negativa. Some a 0 PV ou no fim da cena. `
        + "Não age sem ordem: ação de movimento do conjurador faz todos andarem, ação padrão faz todos causarem dano a criaturas adjacentes. "
        + `${mv.defesa == null ? "Não tem valor de Defesa nem testes de resistência e" : `Defesa ${mv.defesa}; não tem testes de resistência e`} falha automaticamente em testes opostos.</p>` } },
    },
    itens: [ordem("Causar Dano", `Ordem (ação padrão do conjurador): ${danoTexto} numa criatura adjacente.${texto}`, mv.danos,
      { res: mv.condicao || mv.perdaPM ? `Fortitude (CD ${cd})` : "", rolls, efeitos })],
    ajustes: { defesa: mv.defesa ?? 0 },
  };
}

/** Uma invocação ativa por conjurador e magia: a chave acha a anterior pra sumir com ela. */
function pedidoDeFicha(ficha, { actor, item, casterToken, posicoes }) {
  return {
    ficha, posicoes, chave: `${actor.id}:${item.name}`,
    disposition: casterToken?.document.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY,
  };
}

// ─── Detecção: card do sistema com itemData + nome do item no registro ────────
Hooks.on("createChatMessage", async (msg, _opts, userId) => {
  if (userId !== game.user.id || !msg.flags?.tormenta20?.itemData) return;
  const actor = ChatMessage.getSpeakerActor(msg.speaker);
  const itemId = msg.content?.match(/data-item-id="([^"]+)"/)?.[1];
  const item = actor?.items.get(itemId);
  const montar = INVOCACOES[item?.name];
  if (!montar) return;
  const casterToken = canvas.tokens?.get(msg.speaker.token) ?? actor.getActiveTokens()[0];
  const pedido = await montar({ msg, actor, item, casterToken });
  if (!pedido) return;
  Object.assign(pedido, { userId: game.user.id, sceneId: canvas.scene.id });
  if (game.user.isGM) return invocar(pedido);
  if (!game.users.activeGM) return ui.notifications.warn("O Mestre precisa estar online para invocar.");
  game.socket.emit(SOCKET, pedido);
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, (pedido) => { if (game.user === game.users.activeGM) invocar(pedido); });
});

// ─── Lado do GM: posse + tokens + ajustes ─────────────────────────────────────
async function invocar(pedido) {
  if (pedido.ficha) return invocarFicha(pedido);
  const { atorBase, posicoes, disposition, atualizarAtor, dano, userId, sceneId } = pedido;
  const base = game.actors.getName(atorBase);
  const scene = game.scenes.get(sceneId);
  if (!base || !scene) return ui.notifications.error(`${ID}: ator "${atorBase}" ou cena não encontrados.`);
  // Token não vinculado herda a posse do ator base → dono = conjurador
  if (base.ownership[userId] !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
    await base.update({ [`ownership.${userId}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
  }
  const dados = [];
  for (const p of posicoes) {
    const td = await base.getTokenDocument({ ...p, disposition, actorLink: false });
    dados.push(td.toObject());
  }
  const tokens = await scene.createEmbeddedDocuments("Token", dados);
  for (const tok of tokens) {
    const a = tok.actor;
    if (atualizarAtor) await a.update(atualizarAtor);
    if (dano) {
      const poder = a.items.find((i) => i.system.rolls?.some((r) => r.type === "dano"));
      if (!poder) continue;
      const rolls = foundry.utils.deepClone(poder.system.rolls);
      const dmg = rolls.find((r) => r.type === "dano");
      dmg.parts[0][0] = dano.formula;
      dmg.parts[0][1] = dano.tipo;
      await poder.update({ "system.rolls": rolls });
    }
  }
}

const PACK_CONVOCACOES = "tormenta20.convocacoes";
const NOME_PASTA = "Invocações";

/** Some com a invocação anterior da mesma chave (tokens em toda cena + o ator). */
async function dispensar(chave) {
  for (const a of game.actors.filter((x) => x.getFlag(ID, "chave") === chave)) {
    for (const s of game.scenes) {
      const ids = s.tokens.filter((t) => t.actorId === a.id).map((t) => t.id);
      if (ids.length) await s.deleteEmbeddedDocuments("Token", ids);
    }
    await a.delete();
  }
}

async function pastaDeInvocacoes() {
  return game.folders.find((f) => f.type === "Actor" && f.getFlag(ID, "pasta"))
    ?? Folder.create({ name: NOME_PASTA, type: "Actor", flags: { [ID]: { pasta: true } } });
}

async function invocarFicha({ ficha, chave, posicoes, disposition, userId, sceneId }) {
  const scene = game.scenes.get(sceneId);
  const pack = game.packs.get(PACK_CONVOCACOES);
  const molde = (await pack?.getDocuments({ name: ficha.molde }))?.[0];
  if (!scene || !molde) return ui.notifications.error(`${ID}: cena ou "${ficha.molde}" (${PACK_CONVOCACOES}) não encontrados.`);
  await dispensar(chave);

  const dados = molde.toObject();
  delete dados._id;
  foundry.utils.mergeObject(dados, {
    name: ficha.nome, folder: (await pastaDeInvocacoes()).id, system: ficha.system, items: ficha.itens,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED, [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    prototypeToken: { name: ficha.nome, width: ficha.lado, height: ficha.lado, disposition, actorLink: false,
      displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER, bar1: { attribute: "attributes.pv" } },
    flags: { [ID]: { chave } },
  });
  dados.items = ficha.itens;   // o mergeObject juntaria os itens do molde (Arma de Sopro sem o aprimoramento, dano errado)
  const ator = await Actor.create(dados);

  // Defesa e perícias são calculadas (base + atributo + ...): acerta pela diferença o que a regra fixa.
  const { defesa, refl } = ficha.ajustes ?? {};
  const corrigir = {};
  if (defesa != null) corrigir["system.attributes.defesa.base"] = (Number(ator.system.attributes.defesa.base) || 0) + defesa - ator.system.attributes.defesa.value;
  if (refl != null) corrigir["system.pericias.refl.outros"] = (Number(ator.system.pericias.refl.outros) || 0) + refl - ator.system.pericias.refl.value;
  if (Object.keys(corrigir).length) await ator.update(corrigir);

  const tokens = [];
  for (const p of posicoes) tokens.push((await ator.getTokenDocument({ ...p })).toObject());
  await scene.createEmbeddedDocuments("Token", tokens);
}

// "Se for destruído... desaparece": criatura conjurada a 0 PV some do mapa.
Hooks.on("updateActor", (actor) => {
  if (game.user !== game.users.activeGM || !actor.isToken || !actor.getFlag(ID, "chave")) return;
  if ((Number(actor.system.attributes?.pv?.value) || 0) <= 0) actor.token?.delete();
});

// ─── Utilidades de UI (lado do jogador) ───────────────────────────────────────
const TIPOS_FISICOS = ["corte", "impacto", "perfuracao"];
const TIPOS_ELEMENTAIS = ["acido", "fogo", "frio", "eletricidade"];

/** Pergunta só o que os aprimoramentos marcados pedem; devolve null se fechar. */
async function escolhasDoMonstro(p) {
  const opcoes = (lista, marcado) => lista.map((k) => `<option value="${k}" ${k === marcado ? "selected" : ""}>${rotuloDano(k)}</option>`).join("");
  const todos = Object.keys(CONFIG.T20.damageTypes).filter((k) => !["dano", "perda"].includes(k));
  const par = (nome, rotulo) => `<div class="form-group"><label>${rotulo}</label><div class="form-fields">
    <select name="${nome}1">${opcoes(todos, "corte")}</select><select name="${nome}2">${opcoes(todos, "frio")}</select></div></div>`;
  const campos = [
    `<div class="form-group"><label>Tipo de dano</label><div class="form-fields"><select name="tipoDano">${
      p.elemental ? opcoes(TIPOS_ELEMENTAIS, "fogo") : opcoes(TIPOS_FISICOS, "corte")}</select></div></div>`,
    p.escaladaOuNatacao && `<div class="form-group"><label>Deslocamento extra</label><div class="form-fields">
      <select name="escaladaOuNatacao"><option value="climb">escalada</option><option value="swim">natação</option></select></div></div>`,
    p.resistencias && par("res", "Resistência 5 contra"),
    p.imunidades && par("imu", "Imunidade contra"),
  ].filter(Boolean).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Conjurar Monstro" },
    content: campos,
    ok: {
      label: "Conjurar",
      callback: (_ev, btn) => {
        const f = btn.form.elements;
        return {
          tipoDano: f.tipoDano.value, escaladaOuNatacao: f.escaladaOuNatacao?.value,
          resistencias: p.resistencias ? [f.res1.value, f.res2.value] : [],
          imunidades: p.imunidades ? [f.imu1.value, f.imu2.value] : [],
        };
      },
    },
    rejectClose: false,
  });
}

async function escolherPosicoes(n, casterToken, alcance, rotulo) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const pos = await Sequencer.Crosshair.show({
      label: { text: `${rotulo} ${i}/${n}`, dy: 50 },
      location: casterToken ? { obj: casterToken, limitMaxRange: alcance, showRange: true } : undefined,
    });
    if (!pos) break;
    out.push(canvas.grid.getTopLeftPoint({ x: pos.x, y: pos.y }));
  }
  return out;
}

async function escolherTipoDano() {
  const opts = Object.entries(CONFIG.T20.damageTypes)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Tipo de dano da habilidade racial elemental" },
    content: `<select name="tipo" autofocus>${opts}</select>`,
    ok: { label: "Invocar", callback: (_ev, btn) => btn.form.elements.tipo.value },
    rejectClose: false,
  });
}

function animar(posicoes) {
  const seq = new Sequence().sound("Assets/Audio/FX_Holy_Magic_Impact_Small_02.ogg");
  for (const p of posicoes) {
    const c = canvas.grid.getCenterPoint(p);
    seq.effect("jb2a.explosion.07.purplepink").atLocation(c).scale(0.2)
      .effect("jb2a.impact.003.pinkpurple").atLocation(c).scale(0.5);
  }
  seq.play();
}
