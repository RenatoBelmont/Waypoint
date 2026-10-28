# Waypoint — visão geral do app e convenções

Waypoint é um conjunto de ferramentas para devs indie (GDC/GDD, Kanban, Codex, Notas, Mural, Árvore de
Habilidades, Mapas, Ferramentas de balanceamento, Saúde do projeto). Vanilla JS, sem build system, tudo
carregado via `<script>` clássico em `index.html`, na ordem de dependência.

Bibliotecas externas (decisão do Renato: ele quase nunca está offline, então vale usar biblioteca pronta
quando simplifica) — carregadas por CDN com versão fixa no topo do `index.html`, todas OPCIONAIS (o app
funciona sem internet, com fallback): Lucide 0.460.0 (ícones), marked 12.0.2 + DOMPurify 3.1.6 (Markdown
renderizado no preview do GDD, via `GDC.renderMarkdown`). Avaliadas e mantidas como código próprio por
já funcionarem e estarem testadas, sem ganho pro usuário na troca: `pdfWriter.js` (vs jsPDF),
`zipWriter.js` (vs JSZip), seletor de cor do Designer de Cartas.

## Convenções de arquitetura

- Cada aba/ferramenta é um módulo `js/ui/<nome>.js` que expõe `GDC.ui.<nome> = { mount, reset, ... }`
  (ou `{ render }` para as calculadoras simples dentro de "Ferramentas").
- `mount(container, opts)` monta a aba uma vez; `reset(...)` refaz tudo (import/reset de projeto);
  módulos com estado mutável ao vivo (Mural, Árvore de Habilidades) também expõem `syncState(...)` para
  re-render leve após uma mutação local, sem reconstruir o DOM inteiro.
- Estado do projeto inteiro vive em `state.doc` (um objeto grande, `js/app.js`), mutado in-place e
  passado por referência aos módulos no mount — atualizações se propagam sem re-wiring.
- Normalização/validação do schema do documento fica em `js/data.js` (`normalizeDocument`,
  `createEmptyDocument`, e uma função `normalizeX`/`isValidX` por entidade).
- Ferramentas soltas dentro da aba "Ferramentas" (XP Balancer, Loot Simulator, Economy Simulator,
  Combat Balance, Quest Designer, Designer de Cartas) gravam seu estado como uma STRING JSON solta em
  `doc.tools.<chave>` (não são entidades de 1ª classe) — cada uma faz seu próprio `parseStored()`
  defensivo. Módulos que precisam ler dados de outra ferramenta (ex.: Economy Simulator lendo o Loot
  Simulator) fazem esse parse ao vivo, na hora de renderizar — nunca escrevem no namespace de outra
  ferramenta. Um valor default só existe na memória até o usuário mexer no controle — se outro módulo
  precisa enxergar esse default antes disso, o módulo dono precisa exportar os defaults
  (`GDC.LOOT_SIMULATOR_DEFAULT_ITEMS`) pro outro cair de volta neles.
- Mídia (imagens no IndexedDB `waypoint-media`/`images`, fontes customizadas em `fonts`) é referenciada
  por id. `GDC.collectUsedImageIds` / `GDC.collectUsedFontIds` (data.js) são a fonte ÚNICA de "o que
  está em uso" — usadas tanto pela limpeza de órfãs (Saúde) quanto pelo backup completo (storage.js).
  Qualquer módulo novo que guarde id de imagem/fonte precisa ser incluído ali, senão a mídia dele some
  do backup e pode ser apagada como órfã (bug real corrigido no Designer de Cartas).
- Tela cheia: padrão ÚNICO em `js/fullscreen.js` (`GDC.fullscreen.toggle(stageEl)`, evento
  `wpfullscreenchange` no palco, botão via `GDC.fullscreen.buttonMarkup`). É tela cheia dentro da
  página (classe `.wp-fullscreen`, position:fixed cobrindo a janela), NÃO a Fullscreen API do
  navegador/F11 — decisão do Renato, a partir do comportamento de Mapas. Esc sai, a menos que a
  ferramenta já tenha consumido o Esc (fechar menu/desselecionar) com `preventDefault()` — o módulo
  escuta no `window`, depois dos listeners de `document`. Ao entrar, neutraliza ancestrais com
  transform/filter/backdrop-filter (`.wp-fs-ancestor`), que prenderiam o position:fixed dentro deles
  (bug real: Designer de Cartas dentro de `.card-surface`). z-index 70: acima do cabeçalho (50),
  abaixo dos modais (80) e dos popovers do Designer de Cartas (220).
- Palco padrão das ferramentas de quadro/canvas (Mural, Habilidades, Mapas): `.wp-stage` (um card só)
  + `.wp-stage-bar` (barra de ferramentas no topo, separada por linha) + área de trabalho sem borda
  própria. Na barra, exportar + tela cheia ficam sempre no canto direito (`.wp-stage-spacer` antes).
  Botões de ícone: `.wp-icon-btn` (mesma medida do `.mural-tbtn`), separador `.wp-bar-sep`, estado
  ligado `.wp-btn-on` (âmbar). Ferramenta selecionada = fundo âmbar.
- Cabeçalho de cada aba: bloco centralizado `mb-8 text-center` com `.hero-badge` + h2 + subtítulo — em
  TODAS as abas (o GDC era a exceção). Barras de ações das abas: filtros/busca à esquerda, ações à
  direita, numa linha. Largura máxima de conteúdo, cabeçalho e rodapé: 100rem.
- Cabeçalho no padrão do 3D Workbench (outro sistema do Renato — ele quer que os sistemas dele
  compartilhem layout): linha 1 = logo e nome grandes + projeto aberto como subtítulo, ações à direita
  (Projetos, status de salvamento só com ícone de nuvem que expande no hover, tema); linha 2 = faixa
  de abas num card, distribuídas por igual (flex:1), ícone sobre rótulo, aba ativa preenchida com a
  borda âmbar embaixo. O header é sticky com `top` negativo = altura da linha 1 (header.js,
  stickToTabs), então ao rolar só a faixa de abas fica presa no topo.
- Reuso de CSS: primitivos genéricos (`.input-field`, `.btn-primary`, `.btn-ghost`, `.card-surface`,
  `.wp-stage*`, `.wp-icon-btn`, `.mural-tbtn`, `.kanban-color-swatch(es)`, `.xp-bar-wrap`, `.xp-stat`)
  são reaproveitados entre módulos; áreas de trabalho específicas (board-wrap de cada ferramenta)
  ganham cópia própria por módulo, pra não acoplar ferramentas que podem divergir.
- Listeners em elementos que NÃO são recriados (containers, botões fixos) devem ser ligados uma única
  vez no mount, com delegação de eventos pro conteúdo que é re-renderizado — religar a cada render
  empilha listeners (bug real no Designer de Cartas: um drop criava 12 campos).
- Ícones: `GDC.icon(nome)` usa o Lucide (qualquer nome do lucide.dev, em kebab-case) e cai pro
  `PATHS` local de `js/icons.js` offline ou pros 3 desenhos próprios (select-area, dashed-line, door).
  Nome inexistente gera `console.warn('[Waypoint] ícone inexistente: ...')`. Não precisa mais desenhar
  ícone à mão — só conferir que o nome existe no Lucide 0.460 (e, de preferência, adicionar o fallback
  offline em `PATHS`).
- Cuidado com condições de corrida em checagens assíncronas disparadas de vários lugares sem
  sequenciamento (ex.: `GDC.imageStore.listAll()` chamado pelo debounce do autosave, por export, por
  limpeza de órfãs e por troca de aba) — padrão usado: contador monotônico de "request id" capturado
  antes da chamada async, cujo callback só aplica o resultado se o id ainda for o mais recente (visto
  em `health.js`, `refreshNotifyDot`).

## Abas / ferramentas existentes

- **GDC/GDD**: fichas de design por seção, templates de gênero; preview do GDD com Markdown renderizado.
  Seções/grupos personalizáveis por projeto ("Personalizar seções" no builder): `doc.gddLayout =
  { groups: [{ id, label, sections: [{ id, label, placeholder, minChars, color }] }] }` guarda a
  ESTRUTURA inteira (null = padrão do tipo; campo aditivo, sem bump de schema). `GDC.sectionsFor /
  sectionMapFor / groupsFor` aceitam o TIPO ou o DOCUMENTO — quem renderiza o GDD (builder, preview,
  markdown, Saúde, Codex) passa sempre o doc. O resultado é cacheado por objeto de layout (WeakMap):
  toda edição cria um layout NOVO, nunca muta o atual. Remover seção apaga o texto dela de
  `doc.sections` (com confirmação). Grupo "Narrativa" é oferecido como botão, nunca injetado no padrão
  (mudaria a % da Saúde de todo projeto existente). Aplicar template MESCLA as seções (preserva as
  personalizadas).
- **Kanban**: cards, marcos (milestones), prioridade, checklist.
- **Codex**: entradas de worldbuilding tipadas, com grafo de vínculos (`codexGraph.js`). Tipos e campos
  definidos pelo usuário (10 tipos de campo: text, longtext, select, tags, reference, reference-multi,
  stats, number, checkbox, image). Barra de filtros acima da lista: filtro por valor de campo
  select/tags/checkbox/reference (com opção "(vazio)") e ordenação por nome, edição recente ou campo
  number/text/select (vazios sempre por último); busca olha nome, resumo e conteúdo dos campos. Estado
  de filtro/ordenação é só da sessão (`fieldFilters`/`sortState` em codex.js), não vai pro documento.
  Entrada aberta tem modo LEITURA (campos curtos primeiro, depois resumo e textos longos; Markdown
  renderizado, `[[Nome]]` clicável, campos vazios escondidos, ficha técnica em tabela) e EDIÇÃO; abre em leitura se já tem conteúdo, em edição se nova/vazia.
  Linha do tempo: por tipo, quando ele tem campo Número (botão lista/linha do tempo na barra de
  filtros); campos de início/fim/rótulo são adivinhados pelo nome ("Ano", "Fim", "Data aproximada") e
  podem ser trocados; espaço vertical proporcional ao intervalo (escala log em torno da mediana); sem
  data vai pra "A definir"; respeita os filtros. Também só da sessão (`viewByType`/`timelineCfg`).
- **Direção de arte** (aba "Arte", `artDirection.js`): `doc.artDirection = { overview, palettes,
  styles }` (normalizeArtDirection em data.js). Paleta = cores {name, hex, role ∈ ART_COLOR_ROLES} +
  notas + codexIds; estilo = conceito, elementos/materiais (vírgula), interfaces, faça/evite (linha),
  paletteId, imageIds (imageStore — em collectUsedImageIds), codexIds. "Consistência": cores QUASE
  iguais entre paletas diferentes (ΔE76 < 6; idênticas são permitidas, cor compartilhada é legítima),
  contraste Interface×Base < 3:1, paleta sem nenhum papel, estilo sem paleta. O Codex mostra as
  ligações no modo leitura (`GDC.artDirection.linksFor`, chip → `onGotoArt`).
- **Notas**: notas soltas com imagem opcional, linkáveis ao Codex. Botão ler/editar (modo leitura com
  Markdown); lembra a última escolha na sessão, padrão edição.
- `GDC.renderMarkdown(texto, classe, { resolveLink })`: com `resolveLink(nome) → {id,label}|null`, troca
  `[[Nome]]` por `<button class="md-wikilink" data-goto-entry>` ANTES do marked (DOMPurify mantém data-*);
  offline, escapa primeiro e depois insere os links.
- **Mural**: quadro livre (post-its, formas, fluxograma, desenho, imagens), pan/zoom, tela cheia.
- **Árvore de Habilidades** (`skillTree.js`, só fora de boardgame): design tool de skill
  tree/progression — layout em camadas automático, ramos coloridos, custo por nó, vínculo com Codex e
  Quest Designer, tela cheia.
- **Mapas — três visões** (app.js `mountMapsTab`): "Plantas de fase" (levelPlanner.js) / "Mundo e
  radial" / "Tileset hexagonal" (as duas últimas são o MESMO atlas.js: `GDC.ui.atlas.setMode('free'|
  'hex')` filtra a lista de mapas por kind e lembra o último mapa de cada visão), visão lembrada em
  localStorage `gdc:mapsView` ('plan'|'atlas'|'hex'). Cada módulo usa `offsetParent` do próprio root
  pra saber se está visível (atalhos não vazam pro oculto).
- **Tileset hexagonal** (kind 'hex' do atlas): `m.hex = { cols, rows, size, orient: 'pointy'|'flat',
  lines, coordsIn, tiles: {"c,r": tileId}, notes: {"c,r": texto} }` + `m.tileset = [{ id, name,
  terrain|color|imageId }]` (imagem recortada no hexágono; imageId em collectUsedImageIds). pointy =
  linhas ímpares deslocadas (odd-r), flat = colunas ímpares (odd-q); `size` = lado a lado. Ferramentas
  próprias: Pintar peça (B, raio em passos de hexágono via distância cúbica) e Balde (G, flood BFS da
  área contígua igual); borracha apaga peças; seleção mostra peça + nota (bolinha âmbar no hexágono).
  Carimbos, rótulos, regiões, caminhos e rosa dos ventos funcionam igual. Reduzir colunas/linhas
  descarta peças/notas fora. Só os hexágonos visíveis são desenhados no cache de terreno.
- **Atlas** (`atlas.js`; textos e exemplos GENÉRICOS — o Waypoint serve a outros projetos, nada de nomes do Orbit na UI): `doc.atlas = { maps, activeId }` (normalizeAtlas/normalizeAtlasMap em
  data.js, aditivo). kind 'world' (0,0 → width,height; grade quadrada OU hexagonal — `grid.shape`, pointy-top com
  linhas ímpares deslocadas, `cell` = largura do hexágono, `hexAt` acha o centro mais próximo — com
  coordenadas A1.. nas bordas; rosa dos ventos) e 'radial' (centro 0,0, raio R; anéis {r0,r1 em fração do raio, setores,
  giro, células {name,c}} + ramais {count, offset, r0, r1, width}; contorno de domo). Camadas comuns:
  terreno (traços vetoriais `{t,s,p}` com textura procedural por padrão de canvas preso ao mundo —
  ladrilho 256px = 320 unidades, + 2ª passada com outro ladrilho girado 37° e escala 0,77 pra quebrar
  a repetição — e borda macia via shadowBlur; 'erase' = destination-out), regiões
  (polígono + nome desenhado DEPOIS dos carimbos), caminhos (estrada/trilha/rio/fronteira), carimbos
  (18 desenhos vetoriais em [-1,1] × 24 unidades × escala, ou imagem do imageStore — incluída em
  collectUsedImageIds), rótulos (Região/Local/Detalhe, curva em arco, rotação). Terreno renderizado
  num canvas de cache do tamanho da tela; durante a pintura só o trecho novo é desenhado nele.
  Desfazer por mapa (snapshot JSON, 60 passos; sliders juntam a sequência num passo). Export PNG
  2K/4K/8K (teto de 120 Mpx) redesenhando tudo na escala. A barra de opções tem ALTURA FIXA (rolagem
  horizontal) — se quebrasse em 2 linhas numa ferramenta e 1 noutra, o canvas pularia sob o cursor
  ao trocar de ferramenta (bug real encontrado no teste).
- **Mapas** (`levelPlanner.js`, só projeto `jogo-digital`): planta de fase top-down em canvas 2D, com
  as 4 etapas da técnica top-down (Layout → Fluxo do jogador → Gameplay → Refinamento), cada uma sendo
  também uma camada (mostrar/ocultar/travar) e filtrando as ferramentas visíveis. Entidade de 1ª
  classe `doc.levels = { maps: [...], activeId }` (`normalizeLevels` em data.js; campo aditivo, sem
  bump de SCHEMA_VERSION). Grade quadrada esparsa: `cells` ("x,y" → room/corridor/water/danger/
  secret); paredes externas NÃO são guardadas — saem do contorno do piso na renderização, com hachura
  do lado de fora (ideia emprestada do Dungeon Scrawl); `walls`/`doors` ficam em arestas ("x,y,h" =
  segmento (x,y)→(x+1,y); "x,y,v" = (x,y)→(x,y+1)). Marcadores por célula, rotas
  (principal/alternativa/secreta), textos e notas de revisão (pins). Checagem automática via BFS
  (objetivo alcançável a partir da entrada, áreas isoladas, porta trancada sem chave, marcadores fora
  do piso / inalcançáveis) + estatísticas. Estilos Rascunho, Rascunho escuro (padrão de mapa novo no
  tema escuro) e Blueprint, export PNG com legenda automática, vários mapas por projeto,
  desfazer/refazer por mapa, mapa de exemplo. Grade hexagonal ficou de fora de propósito.
  Carimbos de cenário (ferramenta S, etapa Layout): `map.props = [{ id, k, x, y, s, r, label, imageId }]`
  — 18 desenhos vetoriais top-down (caixa, barril, mesa, cadeira, cama, baú, estante, pilar, escada,
  planta, árvore, pedra, escombros, cobertura, tocha, terminal, duto, estátua) nas cores do estilo, ou
  PNG próprio (imageId em collectUsedImageIds). Escala ímpar encaixa no centro da célula, par na linha
  da grade. SÓ VISUAIS: não entram na checagem de alcance (obstáculo que bloqueia é marcador). A barra
  de opções das plantas também ganhou altura fixa (mesmo bug do canvas pulando).
- **Quest Designer** (`questDesigner.js`): blob `{ arcs: [{id,name,summary}], quests: [...] }`, arcos
  ordenados pela posição; quest tem `arcId` (null = sem arco), `prereqIds` (outras quests),
  `codexIds` (entradas do Codex, só lidas — tools.js repassa `codex` e `onGotoCodexEntry`) e
  `prerequisites` (texto livre antigo, exibido como "Outros requisitos"). Formato antigo `{ quests }`
  abre igual. O primeiro arco criado adota as quests soltas. Opções de pré-requisito excluem quem já
  depende da quest (sem ciclos); aviso quando um pré-requisito está num arco POSTERIOR. Eventos por
  delegação no container (tools.js recria o container a cada render).
- **Importar .md** (`js/ui/mdImport.js`, botão na barra do GDC): divide o .md por nível de título
  (padrão: o mais raso com 5–150 títulos, descendo um nível se o de baixo não passar de 3× — em docs
  de lore, capítulos em "#" e fichas em "##"); cada bloco ganha um destino sugerido — seção do GDD
  (nome igual/prefixo ou pista por id padrão, ex. "Sistemas de Jogo" → mechanics), tipo do Codex que
  casa com o grupo, TIPO NOVO quando o grupo começa como coleção (Personagens, Equipamentos...,
  nome no singular se for uma palavra), ou Nota; sumário/índice é ignorado; entrada já existente no
  tipo vira "Ignorar". `applyPlan` só ACRESCENTA (GDD com "### título" + subtítulos rebaixados; Codex
  com a 1ª tabela de 2 colunas — de preferência a de cabeçalho "Campo" — virando Ficha técnica); o
  app tira instantâneo JSON antes e o aviso oferece "Desfazer" (20 s). Lógica pura exposta em
  `GDC.mdImport` (parse/buildBlocks/suggest/applyPlan) — testável em Node com um `window` falso.
- **Combat Balance — armas** (`combatBalance.js`): campo `weapons` no blob (blobs antigos ganham 3 de
  exemplo). Modos: contínuo (dano/tiro, tiros/s, carga, recarga), carregado (dano, tempo de carga,
  cooldown), único (dano, cooldown). `weaponStats` (dano/ciclo, ciclo, DPS rajada, DPS sustentado,
  % do tempo atirando) e `weaponTimeToKill` (1º tiro em t=0; no contínuo atravessa recargas) —
  expostos em `GDC.ui.combatBalance` pra teste. Matriz inimigo × arma destaca a mais rápida.
- **Diálogos** (`dialogues.js`, só jogo digital): blob `doc.tools.dialogues = { speakers, conversations }`.
  Speaker: cor, expressões próprias [{id,name,color}], `codexId` opcional (nome vazio = nome da
  entrada). Conversa: título, gatilho, `codexIds` ("Sobre"), falas `line`/`choice`; fala tem
  `condition`/`effect` em flags booleanas ("a, !b"; aceita "e"/"não"); opção de escolha tem `effect` e
  `goto` (id de fala, 'end' ou '' = próxima). `analyze` indexa flags do projeto todo (avisa leitura
  positiva sem nenhuma definição, opção sem alvo, escolha sem opção); `simulate` roda com flags
  iniciais + escolhas feitas (guarda de 500 passos contra loop). Ambos expostos pra teste em Node.
- **Ferramentas em sub-abas** (tools.js): Cartas, Diálogos e Quests sempre primeiro; uma ferramenta por vez (strip `[data-tool-tab]`), a aberta
  é lembrada por tipo de projeto em localStorage `gdc:activeTool:<tipo>`; só a ativa é renderizada.
- **Ferramentas**: XP Balancer, Loot Simulator, Economy Simulator, Combat Balance, Quest Designer,
  Designer de Cartas (editor de cartas estilo Canva com camadas, templates, export PNG/PDF/impressão),
  Diálogos, e para boardgame Calculadora de Probabilidade e Balanceador de Baralho.
- **Saúde**: painel de progresso do projeto — % do GDD preenchido, marcos do Kanban, recomendação do
  que trabalhar agora, aviso de backup desatualizado, aviso de imagens órfãs no IndexedDB, com bolinha
  de notificação na aba (`GDC.ui.health.refreshNotifyDot(doc)`). Cartão "Status do Codex": tipos com um
  seletor cujo rótulo contém "status" — barra por opção e lista "Em aberto" (opções que casam com
  `PENDING_STATUS_RE`: proposta, a definir, a criar, rascunho...), clicável para abrir a entrada.

## Mapas: pacote de terreno (arte do Renato)

- `js/terrainPack.js` (`GDC.TERRAIN_PACK`, ~1,7 MB): 88 texturas (256 px, emendadas pra repetir) em 8
  categorias e 92 pincéis recortados com alfa (manchas, copas de árvore, cristas "line", margens
  "edge", espalhados). Tudo em data: URI WebP — imagem de arquivo (file://) suja o canvas e quebraria
  o export PNG. Gerado por `tools/build_pack.py` (+ `seamless.py`, `cut_brushes.py`) a partir dos
  atlas; refazer o arquivo, não editar à mão.
- Ids: textura `px-<cat>-<n>` (vale onde vale um terreno procedural: pincel, balde, peça hexagonal —
  `terrainInfo`/`isTerrainId`); pincel `bk-<linha>-<col>` (ferramenta "Pincel de carimbo", tecla D, e
  carimbo com `k` = id). Carimbos ao longo do traço são determinísticos (semente = id do traço);
  cristas/margens giram com a direção do traço (`angle` = orientação natural da imagem).
- Opacidade: `o` em traços (pincel, carimbo de pincel, balde, borracha) e carimbos. Traço com o<1 é
  desenhado inteiro numa camada e composto de uma vez (senão escurece onde se sobrepõe); ao vivo, idem
  (`liveLayer`). Balde: raster de classes codificado em R e G (até 144 terrenos) e pincéis de carimbo
  contam como limite.
- Carimbos de objetos em categorias próprias: `js/stampPack.js` (`GDC.STAMP_PACK`, ids `ob-<cat>-<n>`,
  kind 'object'), gerado por `tools/build_stamps.py saida.js "Categoria" pasta [...]` (recorta pela
  transparência, ≤512 px, WebP). Entram em `PACK_BR` (mesmo desenho/giro/escala/opacidade dos carimbos
  do pacote), aparecem primeiro na biblioteca do Carimbo e NÃO no Pincel de carimbo. 1ª categoria:
  "Sci-fi e ruínas" (17 objetos do Renato, vista 3/4).
- `DATA_REVISION` = 2 por causa disso.
- Desempenho (Renato usa um notebook modesto no trabalho): NÃO repintar todos os traços a cada quadro.
  Arrastar/zoom reaproveita o bitmap do terreno deslocado/escalado (`terrainXform`) e repinta só 140 ms
  depois que a vista para (`settleTimer`); antes de um traço começar, `syncTerrainCache` alinha o cache.
  Borda macia = 3 passadas concêntricas (nada de shadowBlur, caro demais por movimento). Texturas do
  pacote pré-carregadas ao serem escolhidas. Medido (CPU 4× mais lenta, sem GPU): arrastar 15 passos
  38,8 s → 0,9 s; pincel 40 passos 5,3 s → 2,8 s. Texturas: 512 px é o teto recomendado.

- Fundo dos mapas: `js/paperTexture.js` (`GDC.paperTexture`) — grão de papel (foto do Renato, 512 px,
  só o relevo em torno de 128, emendado). Cada estilo pinta o grão sobre a própria cor; o ladrilho
  colorido é calculado 1× por cor e usado como padrão comum (nada de blend por quadro). Preso ao mapa
  (Atlas: 1 px = 1 unidade; Plantas: 512 px = 16 células) + vinheta por cima.
- Carimbos: giro na barra (e "Giro aleatório"), alças na seleção como no Designer de Cartas (● em cima
  gira, Shift = 15°; ■ no canto escala), `[`/`]` giram 15°, Ctrl+D duplica, setas movem (Shift = 10×).
  O Designer é DOM/CSS e os mapas são canvas: o que se reaproveita é o padrão de interação (ângulo
  medido do norte, sentido horário), não o código.

## Cores (padrão único)

- `js/colorPicker.js` (`GDC.colorPicker`) é o seletor do app inteiro: quadrado S/V + matiz + HEX + conta-gotas
  + Recentes (globais em localStorage `gdc:recentColors`; o Designer de Cartas passa as do baralho) +
  Favoritas + Harmonia (só onde se montam combinações: Designer de Cartas e paletas da Arte —
  `[data-color-harmony]`). Um listener global de clique (captura) intercepta TODO `<input type="color">`
  (exceto `[data-native-color]` e os escondidos do Designer de Cartas), abre o seletor e devolve o valor
  no input disparando `input` (ao vivo) e `change` (ao fechar) — os módulos não mudaram. Se o módulo
  re-renderizar no meio, o input é reencontrado por um seletor montado dos seus data-*.
- Amostras sugeridas são quadradinhas (pedido do Renato); "cor personalizada" = quadrado arco-íris.
- Popover fica no body (z 220); menus com fechamento por clique fora precisam ignorar `.wp-color-popover`
  (feito no Mural).

## Backup, troca de máquina e versão do app

- Renato alterna entre vários computadores (trabalho, pessoal, o do Bruno) levando o "Backup completo"
  (doc + imagens/fontes em base64). Import SUBSTITUI o projeto aberto (não faz merge).
- `GDC.DATA_REVISION` (data.js): **suba o número sempre que entrar um campo novo no documento.**
  SCHEMA_VERSION só muda com migração; campos aditivos não mudavam nada, e uma cópia antiga do app
  descartava em silêncio o que não conhecia. Todo save em localStorage e todo export gravam
  `appRevision` (exports também `exportedAt`; nome do arquivo leva data e hora).
  - Import de arquivo com `appRevision` maior: recusado (parseImportedJson).
  - Projeto salvo no navegador por revisão maior (`GDC.storedDocRevision`): abre SÓ LEITURA
    (`state.readOnly` — autosave e exports bloqueados, faixa vermelha). Cópias anteriores a essa
    proteção não têm a checagem.
- Import passa por `GDC.ui.backupImport` (backupImport.js): mostra arquivo x projeto local, alerta se
  o arquivo é mais antigo que a última alteração local (tolerância de 60 s por relógios diferentes),
  se não traz imagens ou se é de outro tipo; opções Substituir / Importar como novo projeto.
  A data local é `updatedAt` do índice de projetos (só muda quando o autosave grava; abrir não muda).
- Autosave tem debounce de 600 ms; `flushAutosave` grava na hora em pagehide/beforeunload/aba oculta.

## Testes

Sem framework de teste formal — verificação via scripts Playwright ad-hoc (headless Chromium local,
servido por `python3 -m http.server`). O CDN não é acessível no ambiente de teste: as bibliotecas são
baixadas via `npm pack` (mesmas versões) e servidas com `page.route('https://cdn.jsdelivr.net/npm/**')`;
um segundo cenário aborta essas rotas pra validar o fallback offline. Renato pediu pra economizar
tokens com testes: rodar só o necessário (lógica fácil de quebrar sutilmente, ou renderização em
canvas/layout que não dá pra validar lendo código) e passar listas de teste manual pra ele no resto.
Antes de entregar: `node --check` em todo `.js` tocado e extrair o zip num diretório limpo. O zip que o
Renato manda pode trazer uma pasta `(OLD)` — ignorar e não incluir no zip de entrega.

Detalhe de timing pra testes: `AUTOSAVE_DELAY = 600ms` em `app.js` — qualquer teste que edita um campo
e recarrega a página em seguida precisa esperar mais que isso antes do reload. Semear projeto pra teste:
`GDC.createProject(nome, tipo)` + `GDC.setActiveProjectId(id)` + `GDC.saveDocumentToStorage(id, doc)` e
recarregar.

## Histórico de bugs relevantes

- **Dot de notificação da Saúde "não sumia"**: condição de corrida entre chamadas assíncronas de
  `GDC.imageStore.listAll()` — corrigido com contador de request id em `health.js`.
- **Backup completo sem mídia do Designer de Cartas**: a varredura de ids do backup era separada (e
  mais curta) que a da limpeza de órfãs e não enxergava `doc.tools.cardDesigner` nem capas do Kanban;
  unificado em `collectUsedImageIds`/`collectUsedFontIds`.
- **Abas do cabeçalho cortadas** depois que Mapas entrou (9 abas): `justify-content:center` com
  overflow escondia "GDC" atrás do botão Projetos sem permitir rolar até ele.
- **Codex lendo texto do GDC desatualizado**: o Codex guardava a referência a `doc.sections` do mount, e
  aplicar um template troca esse objeto — agora lê sempre de `gddDoc.sections` (o doc é passado no
  mount/reset).
