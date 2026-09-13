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

## Requisitos

- Sequencer (para o crosshair).
- Um ator chamado **Espírito Balístico** no mundo (não vinculado ao token).

## Instalação

Copie (ou clone) a pasta para `Data/modules/t20-invocacoes` e ative o módulo no mundo.

## Desenvolvimento

```bash
node scripts/regras.mjs --check
```

Para adicionar outra invocação, registre uma entrada em `INVOCACOES` com o nome exato da magia.
