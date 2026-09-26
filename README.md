# Wyrt Dimensional

Módulo para Foundry VTT 13 e o sistema Tormenta20 que automatiza o baralho da cena do Wyrt Dimensional: compra por rodada, iniciativa pelas cartas, ações por naipe, figuras e Curinga, com uma HUD sincronizada entre mestre e jogadores.

> **Módulo de fã, não oficial.** Ele não traz os textos nem as artes do suplemento. As regras aparecem só se o mestre escrevê-las no editor do módulo, e as artes vêm dos baralhos do Foundry ou de uma pasta do próprio mestre. Para jogar a cena, você precisa do suplemento. Tormenta20 e Wyrt Dimensional pertencem à Jambo Editora.

## Instalação

Em **Configuração → Módulos Complementares → Instalar Módulo**, cole o manifesto:

```
https://github.com/ahahayd/wyrt-dimensional/releases/latest/download/module.json
```

## Preparando a mesa

### Artes das cartas

Em **Configurar Definições → Wyrt Dimensional → Artes das cartas**:

- **Foundry — escuro e dourado** (padrão) ou **Foundry — claro**: são os baralhos que já vêm com o Foundry. Não é preciso fazer nada.
- **Pasta personalizada**: escolha uma pasta em **Pasta das artes personalizadas**. Ela precisa ter 55 arquivos PNG com estes nomes:

| Cartas | Arquivos |
| --- | --- |
| Numéricas | `copas 2.png` … `copas 10.png` (o mesmo para `paus`, `espadas` e `ouros`) |
| Figuras e Ás | `copas A.png`, `copas J.png`, `copas Q.png`, `copas K.png` (o mesmo para os outros naipes) |
| Curingas | `coringa preto.png`, `coringa vermelho.png` |
| Verso | `verso.png` |

### Regras

Clique no ícone de livro (na HUD ou no painel do mestre) e em **Editar regras**. O mestre pode escrever ou colar ali o texto do próprio suplemento. Os jogadores veem esse texto ao clicar no livro. Enquanto o mestre não escrever nada, o livro avisa que as regras ainda não foram preparadas.

### Adversário

O mestre controla a mão do adversário da cena. O nome exibido para todos é definido no campo **Nome do adversário** do painel e, se ficar vazio, aparece "Adversário".

## Como usar

1. Ative o módulo no mundo.
2. Crie um encontro no rastreador de combate com os personagens e o adversário.
3. O mestre abre o botão **Wyrt** ao lado da barra lateral.
4. Escolha o **encontro vinculado**, marque os jogadores, escolha o combatente do adversário e clique em **Iniciar Wyrt**.
5. As mãos são compradas na hora. A cada nova rodada do encontro, o módulo completa as mãos e reordena a iniciativa.

Cada jogador vê só a própria mão. Clique em uma carta para usá-la ou no `×` para descartá-la. A HUD do mestre controla a mão do adversário, e os jogadores veem essa mão fechada no topo da tela.

## O que é automatizado

- Mãos completadas no início de cada rodada (3 cartas por jogador e 5 para o adversário, ajustáveis pelo mestre de 1 a 12).
- Iniciativa pela maior carta numérica de cada mão (pode ser desligada no painel).
- Ação de cada naipe e controle visual das ações de movimento/padrão já gastas no turno.
- Ás fora do limite do turno, benefícios especiais de Valete, Rainha e Rei, e Curinga emulando outra carta.
- Monte único, reembaralhado a partir do descarte quando acaba.
- Mensagens no chat para jogadas e descartes, com **Reverter** na mesma rodada.

## Painel do mestre

- Todas as mãos em uma janela, com **modo às cegas** opcional.
- Limite de compra individual, carta aleatória ou escolhida, descarte de mão e completar mãos.
- Pedidos de carta extra dos jogadores, com aprovação pelo chat (configurável).
- **Espectadores** (Assistentes de GM, por padrão, ou um usuário escolhido) veem todas as mãos abertas, sem controles, como numa transmissão.

## Configurações

Em **Configurar Definições → Wyrt Dimensional**:

- **Desabilitar Wyrt Dimensional**: remove o módulo da mesa sem apagar a sessão.
- **Qualidade visual** (por dispositivo): Alta, Média ou Baixa.
- **Ocultar mão do adversário dimensional** (por dispositivo, para jogadores).
- **Assistente de GM é espectador** e **Definir usuário como espectador**.
- **Jogadores devem pedir permissão para comprar cartas extras**.
- **Artes das cartas** e **Pasta das artes personalizadas**.

## API

Macros e outros módulos podem usar `game.modules.get("wyrt-dimensional").api`: o estado da sessão (cópia), a busca de cartas, o envio de operações e `canUseAction(userId, action)`.

## Licença

O código é distribuído sob a licença MIT (veja [LICENSE](LICENSE)). As artes padrão são as do próprio Foundry VTT e não fazem parte deste pacote.
