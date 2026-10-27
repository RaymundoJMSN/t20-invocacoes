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

- **Exército dos Mortos** (Dragão Brasil): como a de cima, mas capangas de 1 PV com Defesa (18 a 35),
  mais guerreiro perpétuo e zumbi peçonha (que também valem na Conjurar Mortos-Vivos, Ameaças de Arton).
- **Enxame de Pestes** e **Enxame Rubro (de Ichabod)**: enxame no mapa no tamanho certo (1,5m, 3m ou 6m),
  com o dano no espaço (dados extras, variante maiores/elementais e tipo escolhido, trevas, voo 18m,
  agarrar e parasitas no texto). Enxame não tem PV (a magia não dá).
- **Animar Objetos**: escolhe tamanho e quantidade (até 8/8/4/2/1); cada objeto é um token com For,
  Des e PV do tamanho e sem Defesa. O tipo de parceiro de cada um é a opção da própria magia no diálogo.

Magias de **parceiro** não criam criatura com ficha — pela regra, parceiro não tem turno nem PV, só dá
bônus. Nelas, quem recebe ganha o item do pack `tormenta20.parceiros` com **só os efeitos do nível** que
a magia dá (e as chaves erradas dos packs consertadas, como a do Cavalo Iniciante):

- **Aliado Animal**: veterano (mestre com +7 PM), um ou dois tipos diferentes; montaria escolhe o animal.
- **Montaria Arcana**: cavalo veterano (mestre com +3 PM); medo, tamanho e permanência vão na descrição.
- **Conjurar Elemental**: destruidor mestre (habilidade a 2 PM) + o(s) tipo(s) do elemento; com "um de
  cada", cada elemental pode ir pra um aliado na cena.
- **Servo Morto-Vivo**: esqueleto/zumbi iniciante, carniçal ou sombra veterano, múmia mestre. Cada servo
  fica (não substitui o anterior).

E duas que não são criatura nem parceiro:

- **Servos Invisíveis**: cada servo vira um "+2" desmarcado no diálogo de teste de perícia; marcou e
  rolou, aquele servo some.
- **Legião**: marque os alvos (T) antes de lançar. Eles ganham "Dominado (Legião)", o conjurador
  recebe a posse dos tokens e, no fim do turno de cada um em combate, o mestre rola Vontade contra a
  CD; quem passa se livra, fica abalado por 1 rodada e a posse volta.

As que criam criatura geram um ator na pasta **Invocações** a partir do molde do compêndio `tormenta20.convocacoes`
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
