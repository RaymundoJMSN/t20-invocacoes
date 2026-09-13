// t20-invocacoes — magias de invocação automatizadas (Tormenta20, Foundry v13).
// Fluxo: card da magia no chat → lê aprimoramentos → jogador clica os lugares →
// GM (via socket) cria os tokens já ajustados e dá posse ao conjurador.
import { espiritoBalistico, circuloPorNivel, formulaDoRoll } from "./regras.mjs";

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
};

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
async function invocar({ atorBase, posicoes, disposition, atualizarAtor, dano, userId, sceneId }) {
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

// ─── Utilidades de UI (lado do jogador) ───────────────────────────────────────
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
