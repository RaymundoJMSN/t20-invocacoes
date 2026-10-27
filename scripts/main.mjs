// t20-invocacoes — magias de invocação automatizadas (Tormenta20, Foundry v13).
// Fluxo: card da magia no chat → lê aprimoramentos → jogador clica os lugares →
// GM (via socket) cria os tokens já ajustados e dá posse ao conjurador.
import {
  espiritoBalistico, circuloPorNivel, formulaDoRoll,
  conjurarMonstro, perguntasMonstro, conjurarMortosVivos, LADO_TOKEN, EXERCITO,
  enxamePestes, enxameRubro, animarObjetos, OBJETOS, ITEM_PARCEIRO, efeitosDoNivel, consertarChave,
  aliadoAnimal, montariaArcana, conjurarElemental, ELEMENTOS, servoMortoVivo, servosInvisiveis, legiao,
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

  "Conjurar Mortos-Vivos": (ctx) => mortosVivos(ctx),
  "Exército dos Mortos": (ctx) => mortosVivos(ctx, EXERCITO),

  "Enxame de Pestes": async ({ msg, actor, item, casterToken }) => {
    const aprs = msg.flags.tormenta20.onUseEffects ?? [];
    let x = enxamePestes(aprs);
    if (x.escolhas) {
      const r = await perguntar("Enxame de Pestes", [{ nome: "tipo", rotulo: "Tipo de dano", opcoes: x.escolhas.map((k) => [k, rotuloDano(k)]) }]);
      if (!r) return;
      x = enxamePestes(aprs, r);
    }
    return enxame(x, { molde: "Enxame de Pestes", nome: "Enxame", actor, item, casterToken });
  },
  "Enxame Rubro": (ctx) => enxameRubroDe(ctx),
  "Enxame Rubro de Ichabod": (ctx) => enxameRubroDe(ctx),

  "Animar Objetos": async ({ actor, item, casterToken }) => {
    const r = await perguntar("Animar Objetos", [
      { nome: "tamanho", rotulo: "Tamanho", opcoes: Object.entries(OBJETOS).map(([k, o]) => [k, `${o.nome} (até ${o.max})`]), marcado: "med" },
      { nome: "quantidade", rotulo: "Quantos", numero: true, marcado: 4 },
    ]);
    if (!r) return;
    const o = animarObjetos(r.tamanho, r.quantidade);
    const posicoes = await escolherPosicoes(o.quantidade, casterToken, 30, `Objeto ${o.nome}`);
    if (!posicoes.length) return;
    animar(posicoes);
    return pedidoDeFicha(fichaDoObjeto(o, { conjurador: actor }), { actor, item, casterToken, posicoes });
  },

  // ── Parceiros: a regra não cria criatura com ficha (parceiro não tem turno nem PV); o
  // conjurador (ou o aliado escolhido) recebe o item do pack tormenta20.parceiros no nível da magia.
  "Aliado Animal": async ({ msg, actor }) => {
    const a = aliadoAnimal(msg.flags.tormenta20.onUseEffects ?? []);
    if (a.mensageiro) return void ui.notifications.info("Aliado Animal mensageiro: o animal leva a mensagem, não vira parceiro.");
    const campos = [];
    for (let i = 1; i <= a.quantidade; i++) {
      campos.push({ nome: `tipo${i}`, rotulo: a.quantidade > 1 ? `Animal ${i}` : "Tipo de parceiro", opcoes: a.tipos.map((t) => [t, rotuloParceiro(t)]), marcado: a.tipos[i - 1] });
    }
    campos.push({ nome: "montaria", rotulo: "Se for montaria", opcoes: montariasDoPack().map((n) => [n, n.replace("Montaria: ", "")]) });
    const r = await perguntar("Aliado Animal", campos);
    if (!r) return;
    const tipos = [...new Set(Array.from({ length: a.quantidade }, (_, i) => r[`tipo${i + 1}`]))];
    if (tipos.length < a.quantidade) return void ui.notifications.warn("Aliado Animal: cada animal precisa ser de um tipo diferente.");
    return pedidoDeParceiros(actor, "Aliado Animal", tipos.map((tipo) => ({
      tipo, nivel: a.nivel, alvo: actor.uuid, montaria: tipo === "montaria" ? r.montaria : null,
      nome: `Aliado Animal: ${rotuloParceiro(tipo)}`, nota: "Animal prestativo pela magia Aliado Animal (1 dia).",
    })));
  },

  "Montaria Arcana": async ({ msg, actor }) => {
    const m = montariaArcana(msg.flags.tormenta20.onUseEffects ?? []);
    const extras = [
      "Atravessa terreno difícil sem redução de deslocamento; Misticismo pode substituir Cavalgar (conta como treinado).",
      m.medo && "Animais em alcance curto da montaria: Vontade ou ficam apavorados 1d4 rodadas e depois abalados pela cena (passar = abalados pela cena).",
      m.categoriasExtras && `Tamanho +${m.categoriasExtras} categoria(s) (Enorme leva duas criaturas, Colossal seis).`,
      m.permanente ? "Permanente (−3 PM máximos enquanto durar)." : "Dura 1 dia.",
    ].filter(Boolean).join(" ");
    return pedidoDeParceiros(actor, "Montaria Arcana", [{ tipo: "montaria", nivel: m.nivel, alvo: actor.uuid, nome: "Montaria Arcana", nota: extras }]);
  },

  "Conjurar Elemental": async ({ msg, actor }) => {
    const c = conjurarElemental(msg.flags.tormenta20.onUseEffects ?? []);
    const aliados = aliadosNaCena(actor);
    const elementos = c.todos ? Object.keys(ELEMENTOS) : null;
    const campos = elementos ? [] : [{ nome: "elemento", rotulo: "Elemento", opcoes: Object.entries(ELEMENTOS).map(([k, el]) => [k, el.nome]) }];
    for (const el of elementos ?? [null]) {
      const tipos = el ? ELEMENTOS[el].tipos : [...new Set(Object.values(ELEMENTOS).flatMap((x) => x.tipos))];
      const pre = el ? `${ELEMENTOS[el].nome}: ` : "";
      for (let i = 1; i <= c.tiposPorElemental; i++) {
        campos.push({ nome: `${el ?? "x"}${i}`, rotulo: `${pre}parceiro ${i}`, opcoes: tipos.map((t) => [t, rotuloParceiro(t)]), marcado: tipos[i - 1] });
      }
      if (el) campos.push({ nome: `${el}alvo`, rotulo: `${pre}auxilia`, opcoes: aliados });
    }
    const r = await perguntar("Conjurar Elemental", campos);
    if (!r) return;
    const lista = [];
    for (const el of elementos ?? [r.elemento]) {
      const E = ELEMENTOS[el];
      const alvo = elementos ? r[`${el}alvo`] : actor.uuid;
      const escolhidos = Array.from({ length: c.tiposPorElemental }, (_, i) => r[`${elementos ? el : "x"}${i + 1}`]);
      if (escolhidos.some((t) => !E.tipos.includes(t))) return void ui.notifications.warn(`Elemental ${E.de} só pode ser ${E.tipos.map(rotuloParceiro).join(", ")}.`);
      const nota = `Elemental ${E.de} ${c.tamanho === "eno" ? "Enorme" : "Grande"} (Conjurar Elemental, sustentada). Dano de ${rotuloDano(E.dano)}.`;
      lista.push({ tipo: "destruidor", nivel: "mestre", alvo, nome: `Elemental ${E.de}: Destruidor`, nota: `${nota} A habilidade de destruidor custa só 2 PM.` });
      for (const t of new Set(escolhidos)) lista.push({ tipo: t, nivel: "mestre", alvo, nome: `Elemental ${E.de}: ${rotuloParceiro(t)}`, nota });
    }
    return pedidoDeParceiros(actor, "Conjurar Elemental", lista);
  },

  "Servo Morto-Vivo": async ({ msg, actor }) => {
    const s = servoMortoVivo(msg.flags.tormenta20.onUseEffects ?? []);
    const r = await perguntar(`Servo Morto-Vivo (${s.nome})`, [{ nome: "tipo", rotulo: "Tipo de parceiro", opcoes: s.tipos.map((t) => [t, rotuloParceiro(t)]) }]);
    if (!r) return;
    // instantânea: cada servo é permanente e não substitui o anterior
    return pedidoDeParceiros(actor, `Servo Morto-Vivo ${Date.now()}`, [{ tipo: r.tipo, nivel: s.nivel, alvo: actor.uuid,
      nome: `Servo Morto-Vivo (${s.nome}): ${rotuloParceiro(r.tipo)}`,
      nota: "Uma vez por rodada, quando sofre dano, você pode sacrificar o servo e evitar esse dano (ele é destruído e não pode ser reanimado)." }]);
  },

  // ── Servos Invisíveis: cada servo vira um +2 que aparece no diálogo de perícia e some ao ser usado.
  "Servos Invisíveis": async ({ msg, actor }) => {
    const s = servosInvisiveis(msg.flags.tormenta20.onUseEffects ?? []);
    await criarServos(actor, s.quantidade, `${actor.id}:Servos Invisíveis`);
    ui.notifications.info(`${s.quantidade} servos invisíveis: marque "Servo Invisível" no diálogo de um teste de perícia (+2, não cumulativo; não vale ataque nem resistência).`
      + (s.tarefa ? ` Ou mande fazer uma tarefa: passam num teste com CD até ${(Number(actor.system.attributes.nivel?.value) || 0) + 2 * s.quantidade}.` : ""));
  },

  // ── Legião: domina os alvos marcados; cada um testa Vontade no fim do próprio turno.
  "Legião": async ({ msg, actor, item }) => {
    const { alvos } = legiao(msg.flags.tormenta20.onUseEffects ?? []);
    const marcados = [...game.user.targets].slice(0, alvos);
    if (!marcados.length) return void ui.notifications.warn("Legião: marque os alvos (tecla T) antes de lançar a magia.");
    return { dominar: marcados.map((t) => t.document.uuid), cd: cdDaMagia(actor, item), chave: `${actor.id}:Legião`, conjurador: actor.name };
  },
};

async function mortosVivos({ msg, actor, item, casterToken }, tabela) {
  const mv = conjurarMortosVivos(msg.flags.tormenta20.onUseEffects ?? [], tabela);
  const posicoes = await escolherPosicoes(mv.quantidade, casterToken, 9, mv.nome);
  if (!posicoes.length) return;
  animar(posicoes);
  return pedidoDeFicha(fichaDoMortoVivo(mv, { cd: cdDaMagia(actor, item), conjurador: actor }), { actor, item, casterToken, posicoes });
}

function enxameRubroDe({ msg, actor, item, casterToken }) {
  return enxame(enxameRubro(msg.flags.tormenta20.onUseEffects ?? []), { molde: "Enxame Rubro", nome: "Enxame Rubro", actor, item, casterToken });
}

async function enxame(x, { molde, nome, actor, item, casterToken }) {
  const posicoes = await escolherPosicoes(x.quantidade, casterToken, 30, nome);
  if (!posicoes.length) return;
  animar(posicoes);
  return pedidoDeFicha(fichaDoEnxame(x, { cd: cdDaMagia(actor, item), conjurador: actor, molde, nome }), { actor, item, casterToken, posicoes });
}

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

/** Enxame da magia: não tem PV nem Defesa (a magia não dá); o dano é no fim do turno do conjurador. */
function fichaDoEnxame(x, { cd, conjurador, molde, nome }) {
  const tipo = rotuloDano(x.tipo);
  const extras = [
    x.agarra && `Quem falhar no Reflexos fica agarrado (ação padrão + Acrobacia ou Atletismo pra escapar; mover o enxame solta).`,
    x.parasitas && "No início de cada turno do conjurador, role 1d6: 5 ou 6 cria um enxame novo adjacente a um existente.",
  ].filter(Boolean).join(" ");
  return {
    molde, nome: `${nome} de ${conjurador.name}`, lado: x.lado,
    system: {
      atributos: atributos(0, 0),
      attributes: { pv: { value: 0, max: 0 }, movement: { walk: x.desl.walk, fly: x.desl.fly, climb: 0, swim: 0, burrow: 0, hover: false, unit: "m" } },
      tracos: { tamanho: x.tamanho },
      detalhes: { biography: { value: `<p>Conjurado por ${conjurador.name}. Passa pelo espaço de outras criaturas e não as impede de entrar no dele. `
        + `Ação de movimento do conjurador: move ${x.desl.fly ? `voando ${x.desl.fly}m` : `${x.desl.walk}m`}.</p>` } },
    },
    itens: [ordem("Dano no Espaço", `No fim de cada turno do conjurador: ${x.formula} de ${tipo} em cada criatura no espaço do enxame (${x.teste} CD ${cd} reduz à metade). ${extras}`,
      [{ formula: x.formula, tipo: x.tipo }], { res: `${x.teste} reduz à metade (CD ${cd})` })],
  };
}

/** Objeto animado: construto com For/Des/PV do tamanho; o tipo de parceiro sai do diálogo da magia. */
function fichaDoObjeto(o, { conjurador }) {
  return {
    molde: "Monstro Conjurado (P)", nome: `Objeto Animado (${o.nome}) de ${conjurador.name}`, lado: LADO_TOKEN[o.tamanho], img: "icons/svg/chest.svg",
    system: {
      atributos: atributos(o.for, o.des),
      attributes: { pv: { value: o.pv, max: o.pv }, movement: { walk: 9, climb: 0, swim: 0, fly: 0, burrow: 0, hover: false, unit: "m" } },
      tracos: { tamanho: o.tamanho, ic: { value: [], custom: "Sem testes de resistência; falha automaticamente em testes opostos" } },
      detalhes: { biography: { value: `<p>Objeto animado por ${conjurador.name} (Animar Objetos). Funciona como parceiro (${o.parceiros}) — `
        + "marque o tipo no diálogo da magia — e, diferente de parceiro comum, pode ser alvo de ataque direto. "
        + "Ação de movimento do conjurador: comanda um objeto em alcance pra auxiliar alguém. Sem Defesa.</p>" } },
    },
    itens: [],
    ajustes: { defesa: 0 },
  };
}

const ROTULO_PARCEIRO = { ajudante: "Ajudante", assassino: "Assassino", atirador: "Atirador", combatente: "Combatente", destruidor: "Destruidor",
  fortao: "Fortão", guardiao: "Guardião", medico: "Médico", montaria: "Montaria", perseguidor: "Perseguidor", vigilante: "Vigilante" };
const rotuloParceiro = (t) => ROTULO_PARCEIRO[t] ?? t;
const PACK_PARCEIROS = "tormenta20.parceiros";
const montariasDoPack = () => [...(game.packs.get(PACK_PARCEIROS)?.index ?? [])].map((i) => i.name).filter((n) => n.startsWith("Montaria:")).sort();

/** Personagens com token na cena (o conjurador primeiro), pra quem o parceiro pode ir. */
function aliadosNaCena(actor) {
  const lista = new Map([[actor.uuid, actor.name]]);
  for (const t of canvas.tokens?.placeables ?? []) if (t.actor?.type === "character") lista.set(t.actor.uuid, t.actor.name);
  return [...lista];
}

function pedidoDeParceiros(actor, magia, parceiros) {
  return { parceiros, chave: `${actor.id}:${magia}` };
}

/** Diálogo genérico: campos {nome, rotulo, opcoes:[[valor, rótulo]], marcado, numero}. Devolve {nome: valor} ou null. */
async function perguntar(titulo, campos) {
  const html = campos.map((c) => `<div class="form-group"><label>${c.rotulo}</label><div class="form-fields">${c.numero
    ? `<input type="number" name="${c.nome}" value="${c.marcado ?? 1}" min="1">`
    : `<select name="${c.nome}">${c.opcoes.map(([v, r]) => `<option value="${v}" ${v === c.marcado ? "selected" : ""}>${r}</option>`).join("")}</select>`}</div></div>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: titulo }, content: html, rejectClose: false,
    ok: { label: "Confirmar", callback: (_ev, btn) => Object.fromEntries(campos.map((c) => [c.nome, btn.form.elements[c.nome].value])) },
  });
}

// ─── Servos Invisíveis (lado do dono da ficha, não precisa do GM) ─────────────
const NOME_SERVO = "Servo Invisível";

async function criarServos(actor, n, chave) {
  const antigos = actor.effects.filter((e) => e.getFlag(ID, "servo")).map((e) => e.id);
  if (antigos.length) await actor.deleteEmbeddedDocuments("ActiveEffect", antigos);
  // desligado = aparece desmarcado no diálogo de perícia e não entra sozinho em rolagem rápida
  await actor.createEmbeddedDocuments("ActiveEffect", Array.from({ length: n }, () => ({
    name: NOME_SERVO, img: "icons/svg/aura.svg", disabled: true, transfer: false,
    changes: [{ key: "roll", mode: 2, value: "2", priority: null }],
    flags: { tormenta20: { onuse: true, skill: true, custo: "0", items: "" }, [ID]: { servo: chave } },
  })));
}

// Servo usado num teste: some um por servo marcado.
Hooks.on("createChatMessage", async (msg, _o, userId) => {
  if (userId !== game.user.id) return;
  const usados = (msg.flags?.tormenta20?.onUseEffects ?? []).filter((e) => e.description === NOME_SERVO)
    .reduce((s, e) => s + (Number(e.qty) || 1), 0);
  if (!usados) return;
  const actor = ChatMessage.getSpeakerActor(msg.speaker);
  const ids = actor?.effects.filter((e) => e.getFlag(ID, "servo")).slice(0, usados).map((e) => e.id) ?? [];
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
});

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
  if (pedido.parceiros) return darParceiros(pedido);
  if (pedido.dominar) return dominar(pedido);
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
  if (ficha.img) dados.img = dados.prototypeToken.texture.src = ficha.img;
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

// "Se for destruído... desaparece": criatura conjurada a 0 PV some do mapa (enxame não tem PV: fica).
Hooks.on("updateActor", (actor) => {
  if (game.user !== game.users.activeGM || !actor.isToken || !actor.getFlag(ID, "chave")) return;
  const pv = actor.system.attributes?.pv ?? {};
  if (Number(pv.max) > 0 && (Number(pv.value) || 0) <= 0) actor.token?.delete();
});

// ─── Parceiros: item do pack tormenta20.parceiros, só com os efeitos do nível ─
async function darParceiros({ parceiros, chave }) {
  await dispensarParceiros(chave);
  const pack = game.packs.get(PACK_PARCEIROS);
  for (const p of parceiros) {
    const alvo = await fromUuid(p.alvo);
    const nomeItem = p.montaria || ITEM_PARCEIRO[p.tipo];
    const doc = (await pack?.getDocuments({ name: nomeItem }))?.[0];
    if (!alvo || !doc) { ui.notifications.warn(`${ID}: parceiro "${nomeItem}" ou alvo não encontrado.`); continue; }
    const dados = doc.toObject();
    delete dados._id;
    dados.name = p.nome;
    // os packs têm chave digitada errada (Cavalo Iniciante: "system. attributes...") e efeito de AE sem flags.tormenta20
    dados.effects = efeitosDoNivel(dados.effects ?? [], p.nivel).map((ef) => ({
      ...ef, changes: (ef.changes ?? []).map((c) => ({ ...c, key: consertarChave(c.key) })),
      flags: { ...ef.flags, tormenta20: ef.flags?.tormenta20 ?? {} },
    }));
    const nivel = p.nivel[0].toUpperCase() + p.nivel.slice(1);
    dados.system.description.value = `<p><b>Parceiro ${nivel}.</b> ${p.nota ?? ""}</p>${dados.system.description.value ?? ""}`;
    dados.flags = { ...dados.flags, [ID]: { chave } };
    await alvo.createEmbeddedDocuments("Item", [dados]);
  }
}

/** Some com os parceiros da conjuração anterior (o item e os efeitos que ele passou pra ficha). */
async function dispensarParceiros(chave) {
  for (const a of game.actors) {
    const itens = a.items.filter((i) => i.getFlag(ID, "chave") === chave);
    if (!itens.length) continue;
    const origens = new Set(itens.map((i) => i.uuid));
    const efeitos = a.effects.filter((e) => origens.has(e.origin)).map((e) => e.id);
    if (efeitos.length) await a.deleteEmbeddedDocuments("ActiveEffect", efeitos);
    await a.deleteEmbeddedDocuments("Item", itens.map((i) => i.id));
  }
}

// ─── Legião ───────────────────────────────────────────────────────────────────
const NOME_DOMINADO = "Dominado (Legião)";

function semDialogo() {
  let config = "default";
  try { config = game.settings.get("tormenta20", "UsageConfig"); } catch { /* padrão */ }
  return { shiftKey: config === "default" };
}

/** Dá ao conjurador a posse do token dominado; guarda a anterior pra devolver. */
async function posse(token, userId, nivel) {
  try {
    if (token.actorLink) await token.actor.update({ [`ownership.${userId}`]: nivel });
    else await token.update({ delta: { ownership: { ...(token.actor?.ownership ?? {}), [userId]: nivel } } });
  } catch (err) { console.warn(`${ID} | Legião: não deu pra mudar a posse de ${token.name}`, err); }
}

async function dominar({ dominar: uuids, cd, chave, userId, conjurador }) {
  for (const t of game.scenes.contents.flatMap((s) => s.tokens.contents)) {
    if (t.actor?.effects.some((e) => e.getFlag(ID, "legiao")?.chave === chave)) await liberar(t);
  }
  const nomes = [];
  for (const uuid of uuids) {
    const token = await fromUuid(uuid);
    if (!token?.actor) continue;
    const antes = token.actor.ownership?.[userId] ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    await token.actor.createEmbeddedDocuments("ActiveEffect", [{
      name: NOME_DOMINADO, img: "icons/svg/daze.svg", disabled: false, transfer: false, changes: [],
      description: `Obedece ${conjurador} (exceto ordens claramente suicidas). Vontade CD ${cd} no fim de cada turno pra se livrar.`,
      flags: { tormenta20: {}, [ID]: { legiao: { chave, cd, userId, antes } } },
    }]);
    await posse(token, userId, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    nomes.push(token.name);
  }
  if (nomes.length) ChatMessage.create({ content: `<p><b>Legião</b> (${conjurador}, CD ${cd}): ${nomes.join(", ")} passam a obedecer.</p>` });
}

async function liberar(token, abalar = false) {
  const ef = token.actor?.effects.find((e) => e.getFlag(ID, "legiao"));
  if (!ef) return;
  const { userId, antes } = ef.getFlag(ID, "legiao");
  await ef.delete();
  await posse(token, userId, antes);
  if (abalar) {
    await token.actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Abalado", img: "icons/svg/terror.svg", statuses: ["abalado"],
      duration: { rounds: 1 }, transfer: false, disabled: false, changes: [], flags: { tormenta20: {} } }]);
  }
}

// Fim do turno de um dominado: Vontade contra a CD; passou = livre e abalado por 1 rodada.
Hooks.on("combatTurnChange", async (combat, anterior) => {
  if (game.user !== game.users.activeGM) return;
  const token = combat.combatants.get(anterior?.combatantId)?.token;
  const ef = token?.actor?.effects.find((e) => e.getFlag(ID, "legiao"));
  if (!ef) return;
  const { cd } = ef.getFlag(ID, "legiao");
  const msg = await token.actor.rollPericia("vont", { event: semDialogo() });
  const total = Number((msg?.rolls?.[0] ?? msg)?.total);
  if (total >= cd) {
    await liberar(token, true);
    ChatMessage.create({ content: `<p><b>${token.name}</b> passou na Vontade (${total} contra CD ${cd}) e se livrou da Legião.</p>` });
  }
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
