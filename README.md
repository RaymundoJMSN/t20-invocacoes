# Invocações — Tormenta20

Módulo do Foundry VTT (v13, sistema **Tormenta20**) que automatiza **magias de invocação**:
usou a magia com os aprimoramentos marcados, clica no mapa e a criatura aparece pronta, com
dono, dano e Defesa já ajustados.

Uma entrada por magia no registro `INVOCACOES` de `scripts/main.mjs`. Hoje:

- **Espírito Balístico** (Heróis de Arton p. 252): o card da magia no chat dispara no cliente que
  conjurou; lê os aprimoramentos marcados; um crosshair (Sequencer) pede N posições em alcance
  curto; o GM (via socket) cria os tokens do ator base "Espírito Balístico" na cena, ajusta a
  Defesa para a do conjurador e a fórmula/tipo de dano do poder, e dá posse ao usuário.
  Regras: +1 dado por aprimoramento, limitado pelo maior círculo da ficha; 2 ou 3 espíritos;
  versão elemental usa d8 e pergunta o tipo.
- **Conjurar Monstro** (Livro Básico): pergunta só o que os aprimoramentos marcados pedem (tipo de
  dano, escalada ou natação, os dois tipos de resistência/imunidade), um clique no mapa, e o monstro
  aparece com tamanho, PV, For/Des, deslocamentos (+3m, escalada/natação, voo), percepção às cegas,
  resistências e imunidades da regra. Ordens viram poderes: **Atacar** (só dano, acerta sempre) e
  **Arma de Sopro** (dobro em cone de 6m, Reflexos reduz à metade com a CD da magia). Sem Defesa e
  com o Reflexos do conjurador. Os números de cada tamanho saem do **texto do aprimoramento** na
  ficha (o compêndio do sistema e o livro trazem impressões diferentes; vale a da mesa); o livro
  só entra se o texto não der pra ler.
- **Conjurar Mortos-Vivos** (Livro Básico + Ameaças de Arton): 6 + 1 por aprimoramento, um clique
  por criatura; esqueleto, carniçal (paralisia), sombra (incorpórea, perda de PM), soterrado e fúria
  de Tauron, com PV, dano, imunidades e a condição que o golpe aplica.

As duas criam um ator na pasta **Invocações** a partir do molde do compêndio `tormenta20.convocacoes`
(tipo `simple`, imagem) com a ficha inteira refeita pela regra — os atores do compêndio têm erros
(Sombra com 1 PV, Carniçal com 1d6+3). Conjurar de novo some com a invocação anterior da mesma
magia, e a criatura que chega a 0 PV some do mapa.

## Requisitos

- Sequencer (para o crosshair).
- Um ator chamado **Espírito Balístico** no mundo (não vinculado ao token), só para essa magia.

## Instalação

Copie (ou clone) a pasta para `Data/modules/t20-invocacoes` e ative o módulo no mundo.

## Desenvolvimento

```bash
node scripts/regras.mjs --check
node tests/smoke.mjs
```

O smoke usa `tests/moldes-convocacoes.json`, extraído do pack `convocacoes` do sistema.

Para adicionar outra invocação, registre uma entrada em `INVOCACOES` com o nome exato da magia.
