/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  var SCHEMA_VERSION = 6;
  // Revisão dos DADOS do app (não do schema). SCHEMA_VERSION só muda quando um formato antigo precisa
  // de migração; campos NOVOS e aditivos (atlas, tileset, carimbos...) não mudam o schema — e uma
  // cópia antiga do app, ao abrir um projeto salvo por uma mais nova, normaliza e DESCARTA esses
  // campos em silêncio. Por isso: SUBA ESTE NÚMERO sempre que entrar um campo novo no documento.
  // Cópias com revisão menor que a do arquivo/projeto se recusam a importar e abrem só pra leitura.
  var DATA_REVISION = 2; // 2: opacidade (traços/carimbos), texturas e pincéis do pacote de terreno

  // ---------- Tipos de projeto ----------
  // Controla quais abas/ferramentas fazem sentido montar e qual conjunto de seções de
  // design doc (GDC/GDD) é usado. Definido na criação do projeto, não muda depois.

  var PROJECT_TYPES = [
    { id: 'jogo-digital', label: 'Jogo digital', icon: 'gamepad-2' },
    { id: 'boardgame', label: 'Jogo de tabuleiro / físico', icon: 'dices' },
  ];
  var DEFAULT_PROJECT_TYPE = 'jogo-digital';

  function normalizeProjectType(t) {
    return PROJECT_TYPES.some(function (p) { return p.id === t; }) ? t : DEFAULT_PROJECT_TYPE;
  }

  // ---------- GDD: seções ----------

  var EMPTY_SECTIONS = {
    concept: '', genre: '', platform: '', targetAudience: '',
    gameplay: '', mechanics: '', controls: '', progression: '',
    world: '', characters: '', enemies: '',
    ui: '', art: '', audio: '',
    references: '',
  };

  var SECTIONS = [
    // Fundamentos
    { id: 'concept', group: 'fundamentos', label: 'Conceito', placeholder: 'Em uma ou duas frases, qual é a ideia central do jogo?', minChars: 30, color: '#f59e0b' },
    { id: 'genre', group: 'fundamentos', label: 'Gênero', placeholder: 'Ex: plataforma 2D, roguelike, RPG tático...', minChars: 5, color: '#f97316' },
    { id: 'platform', group: 'fundamentos', label: 'Plataforma', placeholder: 'Ex: PC, console, mobile, web...', minChars: 5, color: '#eab308' },
    { id: 'targetAudience', group: 'fundamentos', label: 'Público-alvo', placeholder: 'Quem é o jogador ideal? Idade, perfil, experiência com jogos...', minChars: 10, color: '#84cc16' },
    // Design e Jogabilidade
    { id: 'gameplay', group: 'design', label: 'Jogabilidade', placeholder: 'Como o jogo é jogado, momento a momento?', minChars: 30, color: '#10b981' },
    { id: 'mechanics', group: 'design', label: 'Mecânicas', placeholder: 'Quais são as mecânicas centrais e como elas se conectam?', minChars: 20, color: '#14b8a6' },
    { id: 'controls', group: 'design', label: 'Controle', placeholder: 'Esquema de controles: teclado, gamepad, touch...', minChars: 10, color: '#06b6d4' },
    { id: 'progression', group: 'design', label: 'Progressão e Níveis', placeholder: 'Como o jogador avança? Estrutura de níveis, curva de dificuldade...', minChars: 15, color: '#0ea5e9' },
    // Mundo e Personagens
    { id: 'world', group: 'mundo', label: 'Mundo e Cenário', placeholder: 'Onde a história acontece? Ambientação, tom, atmosfera...', minChars: 20, color: '#8b5cf6' },
    { id: 'characters', group: 'mundo', label: 'Personagens', placeholder: 'Quem são os personagens principais? Motivações, papéis...', minChars: 15, color: '#d946ef' },
    { id: 'enemies', group: 'mundo', label: 'Inimigos e Desafios', placeholder: 'Que oposição o jogador enfrenta? Inimigos, obstáculos, chefes...', minChars: 10, color: '#f43f5e' },
    // Experiência do Jogador
    { id: 'ui', group: 'experiencia', label: 'Interfaces (UI/UX)', placeholder: 'Como o jogador interage com menus, HUD e feedback visual?', minChars: 10, color: '#3b82f6' },
    { id: 'art', group: 'experiencia', label: 'Arte', placeholder: 'Direção de arte: estilo visual, paleta, referências...', minChars: 15, color: '#ec4899' },
    { id: 'audio', group: 'experiencia', label: 'Áudio', placeholder: 'Trilha sonora, efeitos sonoros, tom musical...', minChars: 10, color: '#6366f1' },
    // Referências
    { id: 'references', group: 'referencias', label: 'Referências', placeholder: 'Jogos, filmes, livros ou outras obras que inspiram o projeto.', minChars: 5, color: '#6b7280' },
  ];

  var SECTION_MAP = SECTIONS.reduce(function (acc, s) { acc[s.id] = s; return acc; }, {});

  var GROUPS = [
    { id: 'fundamentos', label: 'Fundamentos', sectionIds: ['concept', 'genre', 'platform', 'targetAudience'] },
    { id: 'design', label: 'Design e Jogabilidade', sectionIds: ['gameplay', 'mechanics', 'controls', 'progression'] },
    { id: 'mundo', label: 'Mundo e Personagens', sectionIds: ['world', 'characters', 'enemies'] },
    { id: 'experiencia', label: 'Experiência do Jogador', sectionIds: ['ui', 'art', 'audio'] },
    { id: 'referencias', label: 'Referências', sectionIds: ['references'] },
  ];

  // ---------- Templates de gênero ----------

  var GENRE_TEMPLATES = [
    {
      category: 'Ação 2D', name: 'Plataforma', color: '#f59e0b',
      sections: {
        concept: 'Um platformer 2D veloz em que o jogador atravessa fases perigosas usando pulos precisos e movimento baseado em momentum.',
        genre: 'Plataforma / Ação', platform: 'PC e console',
        targetAudience: 'Jogadores casuais e hardcore que gostam de desafios de habilidade e recordes de tempo.',
        gameplay: 'Correr, pular, dar dash e deslizar em paredes por percursos de obstáculos. Coletar moedas, evitar espinhos e derrotar inimigos pisando neles.',
        mechanics: 'Coyote time, buffer de pulo, dash aéreo limitado e combos de movimento fluido.',
        controls: 'Gamepad como padrão, com suporte a teclado. Botões simples: pular, dash, atacar.',
        progression: 'Mapa-múndi linear com caminhos secretos ramificados. Novas habilidades de movimento (duplo salto, dash) liberam áreas antes inacessíveis.',
        world: 'Um reino corrompido por uma força antiga, dividido em biomas distintos.',
        characters: 'Um herói solitário em busca de um artefato roubado para restaurar o equilíbrio do reino.',
        enemies: 'Criaturas corrompidas com padrões de ataque simples, além de armadilhas ambientais e chefes de fase.',
        ui: 'HUD minimalista com contador de moedas e vidas. Menu de seleção de fases no mapa-múndi.',
        art: 'Pixel art vibrante com paleta quente e saturada. Paralaxe nos fundos e animação com squash-and-stretch.',
        audio: 'Trilha eletrônica energética com efeitos sonoros retrô para pulos, coletas e impactos.',
        references: 'Celeste, Hollow Knight, Super Meat Boy.',
      },
    },
    {
      category: 'Exploração', name: 'Metroidvania', color: '#10b981',
      sections: {
        concept: 'Um mundo interconectado em que a exploração libera habilidades que transformam a forma como o jogador se move e luta.',
        genre: 'Metroidvania / Ação-aventura', platform: 'PC e portáteis',
        targetAudience: 'Jogadores que gostam de exploração, backtracking recompensador e descoberta gradual.',
        gameplay: 'Explorar, lutar, desbloquear habilidade, retornar e descobrir. O combate enfatiza esquiva e combos baseados em habilidades.',
        mechanics: 'Mapa que registra salas exploradas e portões bloqueados. Habilidades como gancho, forma esférica e dash elemental.',
        controls: 'Gamepad recomendado, com mapeamento remapeável.',
        progression: 'Cada habilidade abre novas zonas e atalhos. O backtracking é recompensado com lore e upgrades.',
        world: 'Uma mina selada e aparentemente consciente, que remodela seus próprios túneis.',
        characters: 'Um catador que desce à mina em busca de recursos e descobre um mistério maior.',
        enemies: 'Criaturas da mina com comportamentos ligados à área, além de guardiões que testam as habilidades adquiridas.',
        ui: 'Mapa detalhado com marcadores de itens e habilidades. Menu de equipamentos leve.',
        art: 'Ambientes pintados à mão com iluminação dinâmica. Tons terrosos pontuados por acentos bioluminescentes.',
        audio: 'Trilha atmosférica e contemplativa, com temas específicos para áreas-chave e chefes.',
        references: 'Hollow Knight, Metroid Dread, Ori and the Blind Forest.',
      },
    },
    {
      category: 'RPG', name: 'RPG', color: '#8b5cf6',
      sections: {
        concept: 'Um RPG top-down em que escolhas de diálogo e alianças de facção moldam o cenário político de uma cidade-estado fragmentada.',
        genre: 'RPG tático', platform: 'PC e consoles',
        targetAudience: 'Fãs de RPG que valorizam narrativa ramificada e escolhas com consequências.',
        gameplay: 'Exploração em tempo real com combate tático de pausa-e-comando. Grupo de até quatro personagens com árvores de habilidade sinérgicas.',
        mechanics: 'Sistema de reputação por facção que influencia diálogos e disponibilidade de missões.',
        controls: 'Teclado e mouse, com suporte completo a gamepad.',
        progression: 'Hub em mundo aberto com desbloqueios por missão. Níveis de personagem, árvores de habilidade e crafting.',
        world: 'Uma cidade-estado dividida entre três facções rivais, à beira da guerra.',
        characters: 'Um magistrado caído em desgraça reúne um grupo para expor uma conspiração.',
        enemies: 'Milícias de facção, criaturas corrompidas e agentes da conspiração central.',
        ui: 'Diário de missões, árvore de habilidades visual e indicador de reputação por facção.',
        art: 'Baixo-poli estilizado com texturas pintadas. Paletas distintas por distrito e ciclo dia/noite.',
        audio: 'Trilha orquestral adaptativa que reage ao estado das facções.',
        references: 'Disco Elysium, Divinity: Original Sin 2, Dragon Age.',
      },
    },
    {
      category: 'Narrativa', name: 'Visual Novel', color: '#ec4899',
      sections: {
        concept: 'Uma visual novel ramificada sobre memória e identidade, em que o jogador reconstrói um relacionamento esquecido fragmento por fragmento.',
        genre: 'Visual Novel / Drama', platform: 'PC e mobile',
        targetAudience: 'Jogadores que apreciam narrativas emocionais e histórias com múltiplos finais.',
        gameplay: 'Ler, escolher, observar a consequência e reconsiderar. Um quadro de memórias permite reordenar escolhas passadas.',
        mechanics: 'Fragmentos de memória desbloqueiam novas opções de diálogo e interpretações alternativas de cenas.',
        controls: 'Mouse ou toque; avanço de texto por clique/tap.',
        progression: 'Estrutura por capítulos com rotas ramificadas e múltiplos finais.',
        world: 'Interiores domésticos e cenários intimistas ligados às memórias dos personagens.',
        characters: 'Duas pessoas que se conhecem em um grupo de apoio ao luto e percebem compartilhar um passado que nenhuma lembra por completo.',
        enemies: 'Não há antagonistas tradicionais; o conflito é interno e emocional.',
        ui: 'Interface em formato de diário, com toques manuscritos e caixa de diálogo suave.',
        art: 'Retratos pintados à mão com expressões sutilmente animadas. Paleta quente e acolhedora.',
        audio: 'Trilha suave em piano e cordas, com poucos efeitos sonoros para manter o clima intimista.',
        references: 'Coffee Talk, To the Moon, Doki Doki Literature Club.',
      },
    },
    {
      category: 'Puzzle', name: 'Puzzle', color: '#06b6d4',
      sections: {
        concept: 'Um puzzle minimalista sobre redirecionar feixes de luz por uma grade para energizar máquinas adormecidas.',
        genre: 'Puzzle / Lógica', platform: 'Web e PC',
        targetAudience: 'Jogadores que gostam de quebra-cabeças relaxantes e progressão sem pressão de tempo.',
        gameplay: 'Posicionar e girar espelhos, prismas e filtros em uma grade para levar luz de emissores a receptores. Sem cronômetro — pura lógica.',
        mechanics: 'Cada fase introduz uma mecânica nova, combinada gradualmente com as anteriores. Encaixe visual na grade com feedback de brilho.',
        controls: 'Mouse ou toque; arrastar e girar peças.',
        progression: 'Sequência linear de fases com câmaras bônus opcionais. Sem estado de derrota — o jogador experimenta livremente.',
        world: 'Um observatório abandonado onde uma IA adormecida precisa restaurar energia aos seus sistemas.',
        characters: 'A IA protagonista, sem outros personagens ativos.',
        enemies: 'Não há inimigos; o desafio é inteiramente de raciocínio espacial.',
        ui: 'Interface limpa com contraste alto entre grade escura e feixes luminosos.',
        art: 'Estética geométrica minimalista, fundo escuro com feixes de luz brilhantes.',
        audio: 'Sons ambiente etéreos e efeitos de encaixe satisfatórios.',
        references: 'The Witness, Lumines, Baba Is You.',
      },
    },
    {
      category: 'Sobrevivência', name: 'Survival', color: '#f43f5e',
      sections: {
        concept: 'Um jogo de sobrevivência e crafting em um planeta alienígena hostil, em que o ciclo dia-noite impulsiona perigo e oportunidade.',
        genre: 'Survival / Crafting', platform: 'PC e console',
        targetAudience: 'Jogadores que gostam de gerenciamento de recursos e construção de base, sozinhos ou em cooperativo.',
        gameplay: 'Coletar, fabricar, construir e sobreviver. Gerenciar fome, sede, temperatura e oxigênio.',
        mechanics: 'Construção de base modular. À noite, criaturas mais agressivas aparecem.',
        controls: 'Teclado e mouse (PC) ou gamepad (console), com roda de crafting rápido.',
        progression: 'Árvore tecnológica de ferramentas de pedra até armaduras avançadas. Upgrades de base liberam novas estações de crafting.',
        world: 'Um planeta alienígena hostil com biomas distintos: sítio de queda, floresta fúngica, planície de enxofre.',
        characters: 'Um colono sobrevivente à queda de sua nave, que precisa enviar um sinal de socorro.',
        enemies: 'Fauna alienígena agressiva à noite, além de eventos climáticos extremos.',
        ui: 'HUD com indicadores de fome, sede, temperatura e oxigênio. Inventário e roda de crafting.',
        art: 'Realismo estilizado com flora bioluminescente e neblina volumétrica.',
        audio: 'Ambientação sonora alienígena, com música tensa durante a noite.',
        references: 'Subnautica, Valheim, The Forest.',
      },
    },
    {
      category: 'Roguelike', name: 'Roguelike', color: '#84cc16',
      sections: {
        concept: 'Um roguelike de deckbuilding em que cada partida remodela permanentemente o mapa da masmorra para o próximo personagem que entrar.',
        genre: 'Roguelike / Deckbuilder', platform: 'PC e Switch',
        targetAudience: 'Jogadores de roguelikes e deckbuilders que gostam de progressão entre partidas.',
        gameplay: 'Montar deck, enfrentar salas, aprimorar o deck e enfrentar o chefe. Morte permanente com meta-progressão entre partidas.',
        mechanics: 'Cada partida deixa mudanças permanentes no mapa (novas salas, lojas, perigos) para as próximas.',
        controls: 'Gamepad ou mouse, com seleção de cartas por clique.',
        progression: 'Desbloqueios permanentes (novos conjuntos de cartas, relíquias iniciais) pagos com moeda meta entre partidas.',
        world: 'Uma masmorra viva e em constante mudança, explorada por gerações de aventureiros.',
        characters: 'Uma guilda de aventureiros que se revezam explorando a mesma masmorra cambiante.',
        enemies: 'Monstros temáticos por estrato da masmorra, com chefes únicos ao final de cada um.',
        ui: 'Interface de cartas com prévia de efeitos e indicador de relíquias ativas.',
        art: 'Estilo dark fantasy em nanquim, com salas iluminadas proceduralmente.',
        audio: 'Trilha sombria e tensa, com temas variando por estrato.',
        references: 'Slay the Spire, Hades, Monster Train.',
      },
    },
    {
      category: 'Idle', name: 'Idle Game', color: '#3b82f6',
      sections: {
        concept: 'Um construtor de civilização idle em que recursos se acumulam offline e o jogador guia decisões tecnológicas e culturais de longo prazo.',
        genre: 'Idle / Incremental', platform: 'Web e mobile',
        targetAudience: 'Jogadores casuais que preferem sessões curtas e progressão contínua ao longo do tempo.',
        gameplay: 'Definir filas de produção, tomar decisões políticas, esperar e reinvestir. Progresso offline calculado ao retornar.',
        mechanics: 'Prestígio reinicia a civilização em troca de bônus permanentes. Eventos oferecem dilemas morais com consequências duradouras.',
        controls: 'Toque ou clique simples, sem necessidade de controle contínuo.',
        progression: 'Árvore tecnológica com caminhos ramificados. Prestígio desbloqueia novos recursos e mecânicas.',
        world: 'Um assentamento em crescimento, guiado por um espírito protetor ao longo de gerações.',
        characters: 'O espírito guia (o jogador) e o povo do assentamento, representado de forma abstrata.',
        enemies: 'Sem inimigos diretos; os desafios vêm de eventos e dilemas de gestão.',
        ui: 'Painel com visualização clara de dados, filas de produção e árvore tecnológica.',
        art: 'Tiles isométricos planos com animação ambiente suave. Paleta otimista e clara.',
        audio: 'Trilha ambiente relaxante, com variações discretas por era.',
        references: 'Cookie Clicker, NGU Idle, Reigns.',
      },
    },
    {
      category: 'Simulação', name: 'City Builder', color: '#14b8a6',
      sections: {
        concept: 'Um city builder em grade em que cada distrito tem personalidade própria e os cidadãos reagem dinamicamente a decisões de zoneamento e políticas.',
        genre: 'Simulação de construção de cidades', platform: 'PC e console',
        targetAudience: 'Fãs de simulação de gestão que gostam de otimizar sistemas complexos.',
        gameplay: 'Zonear, construir, gerenciar orçamento e responder a eventos. Cidadãos têm necessidades e formam opiniões.',
        mechanics: 'Políticas (impostos, transporte, zoneamento) alteram a satisfação dos distritos.',
        controls: 'Mouse e teclado, com atalhos para ferramentas de construção.',
        progression: 'Desbloqueios por marco populacional: novos edifícios, políticas e distritos. Modo sandbox após a campanha.',
        world: 'Uma cidade em declínio que precisa ser reerguida em uma metrópole próspera.',
        characters: 'Um prefeito recém-eleito e representantes de cada bairro com demandas próprias.',
        enemies: 'Sem inimigos; os desafios vêm de crises urbanas e pressão orçamentária.',
        ui: 'Painéis de dados por distrito, gráficos de satisfação e orçamento.',
        art: 'Estilo tilt-shift em 3D estilizado, com sensação de diorama em miniatura.',
        audio: 'Trilha calma e otimista, com sons ambiente da cidade.',
        references: 'Cities: Skylines, SimCity, Tropico.',
      },
    },
    {
      category: 'Tiro', name: 'FPS', color: '#6366f1',
      sections: {
        concept: 'Um FPS tático em que o tempo retrocede na morte, permitindo reabordar cada confronto com conhecimento das posições inimigas.',
        genre: 'FPS tático', platform: 'PC e console',
        targetAudience: 'Jogadores de FPS que gostam de planejamento tático e repetição estratégica.',
        gameplay: 'Planejar, invadir, lutar, morrer e retroceder no tempo com o conhecimento adquirido.',
        mechanics: 'Retrocessos limitados por missão criam tensão. Cada morte revela posições e rotas de patrulha inimigas.',
        controls: 'Teclado e mouse ou gamepad, com esquema FPS padrão.',
        progression: 'Campanha por missões com resultados ramificados conforme o desempenho. Desbloqueios de armas por avaliação de missão.',
        world: 'Um futuro próximo em conflito militar, com instalações de alta segurança como cenário.',
        characters: 'Um operativo de elite equipado com uma âncora temporal experimental.',
        enemies: 'Forças militares organizadas com rotas de patrulha e reforços táticos.',
        ui: 'HUD projetado diegeticamente no mundo. Efeito visual distinto para o retrocesso temporal.',
        art: 'Estética militar de futuro próximo, ambientes legíveis com silhuetas fortes.',
        audio: 'Trilha tensa orientada a ação, com efeito sonoro reverso característico do retrocesso.',
        references: 'Superhot, Deathloop, Rainbow Six Siege.',
      },
    },
  ];

  // ---------- GDD de boardgame: seções (equivalente ao GDD digital acima, mas com campos que
  // fazem sentido pra jogo de tabuleiro/físico — regras, componentes, playtesting — em vez de
  // gênero/plataforma/controles) ----------

  var BOARDGAME_EMPTY_SECTIONS = {
    concept: '', playersDuration: '', theme: '', audience: '',
    coreLoop: '', mechanics: '', winCondition: '', setup: '',
    components: '', boardDesign: '',
    interaction: '', art: '',
    playtestNotes: '', references: '',
  };

  var BOARDGAME_SECTIONS = [
    // Fundamentos
    { id: 'concept', group: 'fundamentos', label: 'Conceito', placeholder: 'Em uma ou duas frases, qual é a ideia central do jogo?', minChars: 30, color: '#f59e0b' },
    { id: 'playersDuration', group: 'fundamentos', label: 'Jogadores e duração', placeholder: 'Ex: 2–6 jogadores, partidas de 30–50 min...', minChars: 5, color: '#f97316' },
    { id: 'theme', group: 'fundamentos', label: 'Tema e ambientação', placeholder: 'Qual é o tema do jogo? O que ele representa/simula?', minChars: 15, color: '#eab308' },
    { id: 'audience', group: 'fundamentos', label: 'Público-alvo', placeholder: 'Quem é o jogador ideal? Casual, hobbyista, família, grupo experiente...', minChars: 10, color: '#84cc16' },
    // Mecânicas e Regras
    { id: 'coreLoop', group: 'mecanicas', label: 'Estrutura da partida', placeholder: 'Quais são as fases de um turno/rodada, em ordem?', minChars: 20, color: '#10b981' },
    { id: 'mechanics', group: 'mecanicas', label: 'Mecânicas centrais', placeholder: 'Quais mecânicas definem o jogo e como se conectam?', minChars: 20, color: '#14b8a6' },
    { id: 'winCondition', group: 'mecanicas', label: 'Condição de vitória', placeholder: 'Como o jogo termina e como se determina quem venceu?', minChars: 10, color: '#06b6d4' },
    { id: 'setup', group: 'mecanicas', label: 'Preparação (setup)', placeholder: 'Como a mesa é montada antes da primeira rodada?', minChars: 10, color: '#0ea5e9' },
    // Componentes
    { id: 'components', group: 'componentes', label: 'Componentes físicos', placeholder: 'Tabuleiro, cartas, peças, dados, fichas... o que existe fisicamente?', minChars: 15, color: '#8b5cf6' },
    { id: 'boardDesign', group: 'componentes', label: 'Tabuleiro / layout', placeholder: 'Como o espaço de jogo é organizado? Fixo, modular, em grade...', minChars: 10, color: '#d946ef' },
    // Experiência
    { id: 'interaction', group: 'experiencia', label: 'Interação entre jogadores', placeholder: 'Cooperativo, competitivo, negociação, sabotagem...', minChars: 10, color: '#3b82f6' },
    { id: 'art', group: 'experiencia', label: 'Direção de arte / produção', placeholder: 'Estilo visual, materiais, acabamento das peças...', minChars: 10, color: '#ec4899' },
    // Playtesting
    { id: 'playtestNotes', group: 'playtesting', label: 'Notas de playtest', placeholder: 'O que os testes já mostraram? O que mudou por causa deles?', minChars: 10, color: '#6366f1' },
    { id: 'references', group: 'playtesting', label: 'Referências', placeholder: 'Outros jogos, mecânicas ou obras que inspiram o projeto.', minChars: 5, color: '#6b7280' },
  ];

  var BOARDGAME_SECTION_MAP = BOARDGAME_SECTIONS.reduce(function (acc, s) { acc[s.id] = s; return acc; }, {});

  var BOARDGAME_GROUPS = [
    { id: 'fundamentos', label: 'Fundamentos', sectionIds: ['concept', 'playersDuration', 'theme', 'audience'] },
    { id: 'mecanicas', label: 'Mecânicas e Regras', sectionIds: ['coreLoop', 'mechanics', 'winCondition', 'setup'] },
    { id: 'componentes', label: 'Componentes', sectionIds: ['components', 'boardDesign'] },
    { id: 'experiencia', label: 'Experiência', sectionIds: ['interaction', 'art'] },
    { id: 'playtesting', label: 'Playtesting e Referências', sectionIds: ['playtestNotes', 'references'] },
  ];

  var BOARDGAME_TEMPLATES = [
    {
      category: 'Estratégia', name: 'Eurogame', color: '#10b981',
      sections: {
        concept: 'Um jogo de gestão de recursos em que jogadores competem para construir a economia mais eficiente ao longo de várias rodadas.',
        playersDuration: '2–4 jogadores, partidas de 45–90 min.',
        theme: 'Tema leve (comércio, construção ou agricultura) que serve de moldura para a otimização — a mecânica vem antes do tema.',
        audience: 'Jogadores hobbyistas que gostam de planejamento de longo prazo e pouca sorte.',
        coreLoop: 'Escolher ação → pagar custo em recursos → converter em pontos/recursos melhores → passar a vez.',
        mechanics: 'Colocação de trabalhadores ou compra de cartas, conversão de recursos em pontuação, pontuação majoritariamente no fim de jogo.',
        winCondition: 'Quem tiver mais pontos ao fim de um número fixo de rodadas ou ao esgotar um recurso-gatilho.',
        setup: 'Tabuleiro modular ou fixo, cada jogador recebe um conjunto inicial de recursos/cartas idêntico.',
        components: 'Tabuleiro, cartas de ação, marcadores de recurso, peças de pontuação.',
        boardDesign: 'Tabuleiro central fixo com trilhas de recurso e um espaço de ações compartilhado.',
        interaction: 'Competição indireta por espaços/recursos limitados, sem ataque direto entre jogadores.',
        art: 'Arte limpa e funcional, ícones legíveis à distância — prioriza leitura de informação sobre estética.',
        playtestNotes: '',
        references: 'Catan, Terraforming Mars, Agricola.',
      },
    },
    {
      category: 'Festa', name: 'Party Game', color: '#ec4899',
      sections: {
        concept: 'Um jogo de festa rápido e caótico, fácil de explicar em menos de 2 minutos, pensado para grupos grandes e risadas.',
        playersDuration: '4–10 jogadores, partidas de 15–30 min.',
        theme: 'Tema humorístico/social, reforça a interação entre os jogadores mais do que qualquer simulação.',
        audience: 'Grupos casuais em reuniões sociais, incluindo jogadores sem experiência com jogos de tabuleiro.',
        coreLoop: 'Rodada rápida de desafio/decisão → revelação simultânea → pontuação → próxima rodada.',
        mechanics: 'Blefe, votação simultânea, ou desafios de tempo curto; regras mínimas para não travar o ritmo social.',
        winCondition: 'Mais pontos após um número fixo de rodadas, ou primeiro a atingir uma meta de pontos.',
        setup: 'Setup em menos de 2 minutos — poucas peças, sem tabuleiro individual complexo.',
        components: 'Cartas, um marcador de pontuação simples, talvez uma ampulheta.',
        boardDesign: 'Sem tabuleiro fixo, ou um painel central simples só para marcar pontuação.',
        interaction: 'Interação direta e constante entre todos os jogadores a cada rodada.',
        art: 'Visual vibrante e expressivo, ícones grandes, legível mesmo em grupo grande ao redor da mesa.',
        playtestNotes: '',
        references: 'Jackbox Party Pack, Codenames, Concept.',
      },
    },
  ];

  // ---------- Ferramentas ----------

  var EMPTY_TOOLS = {
    xpBalancer: '', lootSimulator: '', economySimulator: '', combatBalance: '', questDesigner: '', dialogues: '',
    probabilityCalc: '', deckBalancer: '', cardDesigner: '',
  };

  // ---------- Kanban: marcos ----------

  var MILESTONE_COLOR_PALETTE = [
    '#f43f5e', '#fb923c', '#f59e0b', '#eab308', '#84cc16', '#10b981',
    '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#94a3b8',
  ];

  var SUGGESTED_MILESTONES = [
    { title: 'Protótipo validado', description: 'A mecânica central foi testada e você decidiu seguir em frente com o conceito.' },
    { title: 'MVP completo', description: 'O menor conjunto de funcionalidades que representa a experiência completa do jogo está pronto.' },
    { title: 'Vertical slice pronta', description: 'Uma fatia representativa do jogo final, com qualidade de produção, está pronta para mostrar.' },
    { title: 'Beta jogável', description: 'O jogo é jogável de ponta a ponta e está pronto para testes externos.' },
    { title: 'Pronto para lançar', description: 'Build final validada, loja preparada — o jogo está pronto para ser publicado.' },
  ];

  var BOARDGAME_SUGGESTED_MILESTONES = [
    { title: 'Protótipo jogável', description: 'A mecânica central foi testada com componentes provisórios (papel, recortes) e funciona.' },
    { title: 'Regras estáveis', description: 'As regras pararam de mudar a cada playtest — o jogo já é ensinável sem ajustes no meio da partida.' },
    { title: 'Arte e componentes finais', description: 'Estilo visual, material e a contagem final de peças estão definidos.' },
    { title: 'Pronto para produção', description: 'Arquivos de impressão/manufatura prontos para enviar à gráfica ou fabricante.' },
    { title: 'Pronto para lançar', description: 'Regras e componentes finais prontos — o jogo está pronto para publicar (Kickstarter, editora, loja).' },
  ];

  function suggestedMilestonesFor(type) {
    return normalizeProjectType(type) === 'boardgame' ? BOARDGAME_SUGGESTED_MILESTONES : SUGGESTED_MILESTONES;
  }

  var TRASH_RETENTION_DAYS = 30;

  // ---------- Kanban: etapa do projeto ----------
  // Pipeline fixo (não editável pelo usuário, diferente das categorias) — a cor de cada etapa é a
  // cor da borda esquerda do card, independente da coluna em que ele está (ver cardBorderColor em
  // kanban.js). A ordem aqui é a ordem "de ideia > lançamento" mostrada nos botões do formulário.
  var KANBAN_STAGES = [
    { id: 'idea', label: 'Ideia', color: '#3b82f6' },
    { id: 'prototype', label: 'Protótipo', color: '#10b981' },
    { id: 'alpha', label: 'Alfa', color: '#f59e0b' },
    { id: 'beta', label: 'Beta', color: '#f97316' },
    { id: 'early-access', label: 'Acesso Antecipado', color: '#8b5cf6' },
    { id: 'launch', label: 'Lançamento', color: '#eab308' },
  ];
  var KANBAN_STAGE_IDS = KANBAN_STAGES.map(function (s) { return s.id; });
  var KANBAN_STAGE_MAP = {};
  KANBAN_STAGES.forEach(function (s) { KANBAN_STAGE_MAP[s.id] = s; });

  // ---------- Kanban: categorias de card ----------
  // Ao contrário da etapa, a lista de categorias é editável — esta é só a semente inicial de um
  // projeto novo (doc.kanban.categories). Ícones do conjunto de js/icons.js.
  var DEFAULT_KANBAN_CATEGORIES = [
    { id: 'cat-programacao', name: 'Programação', icon: 'code' },
    { id: 'cat-arte', name: 'Arte', icon: 'palette' },
    { id: 'cat-animacao', name: 'Animação', icon: 'film' },
    { id: 'cat-game-design', name: 'Game Design', icon: 'gamepad-2' },
    { id: 'cat-audio', name: 'Áudio', icon: 'volume-2' },
    { id: 'cat-level-design', name: 'Level Design', icon: 'mountain' },
    { id: 'cat-ui-ux', name: 'UI/UX', icon: 'smartphone' },
    { id: 'cat-vfx', name: 'VFX', icon: 'sparkles' },
    { id: 'cat-documentacao', name: 'Documentação', icon: 'file-text' },
  ];

  function isValidKanbanCategory(cat) {
    return !!cat && typeof cat === 'object' && typeof cat.id === 'string' && typeof cat.name === 'string';
  }

  function normalizeKanbanCategory(raw) {
    return {
      id: raw.id,
      name: raw.name,
      icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : 'tag',
    };
  }

  // ---------- Codex ----------

  var CODEX_FIELD_KINDS = [
    { id: 'text', label: 'Texto curto' },
    { id: 'longtext', label: 'Texto longo' },
    { id: 'select', label: 'Seletor (uma opção)' },
    { id: 'tags', label: 'Tags (várias)' },
    { id: 'reference', label: 'Referência (uma)' },
    { id: 'reference-multi', label: 'Referência (várias)' },
    { id: 'stats', label: 'Ficha técnica' },
    { id: 'number', label: 'Número' },
    { id: 'checkbox', label: 'Sim / Não' },
    { id: 'image', label: 'Imagem' },
  ];
  var CODEX_FIELD_KIND_IDS = CODEX_FIELD_KINDS.map(function (k) { return k.id; });

  /** Gerador de id compartilhado (usado pelo Codex; os demais módulos mantêm o próprio por compatibilidade). */
  function makeId(prefix) {
    var rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(36).slice(2, 9));
    return (prefix || 'id') + '-' + rnd;
  }

  function codexField(label, kind, extra) {
    return Object.assign({ id: makeId('field'), label: label, kind: kind, options: [], refTypeId: null }, extra || {});
  }

  /** Monta um conjunto de tipos-modelo prontos, com ids novos e referências já ligadas entre si.
   *  Chamado sob demanda pelo botão "Usar conjunto sugerido" — nunca injetado automaticamente,
   *  para não forçar categorias de um gênero específico em cima de outro projeto. */
  function buildSuggestedCodexTypes() {
    var idMundo = makeId('type'), idLocal = makeId('type'), idPersonagem = makeId('type'),
      idFaccao = makeId('type'), idItem = makeId('type'), idMecanica = makeId('type'),
      idNave = makeId('type'), idBoss = makeId('type'), idEvento = makeId('type');

    return [
      { id: idMundo, name: 'Mundo', icon: 'globe', color: '#8b5cf6', gddSectionId: 'world', fields: [
        codexField('Descrição', 'longtext'),
        codexField('Tom / Atmosfera', 'text'),
      ] },
      { id: idLocal, name: 'Local', icon: 'map', color: '#0ea5e9', gddSectionId: 'world', fields: [
        codexField('Imagem de referência', 'image'),
        codexField('Descrição', 'longtext'),
        codexField('Mundo', 'reference', { refTypeId: idMundo }),
      ] },
      { id: idPersonagem, name: 'Personagem', icon: 'user', color: '#d946ef', gddSectionId: 'characters', fields: [
        codexField('Imagem de referência', 'image'),
        codexField('Descrição', 'longtext'),
        codexField('Papel', 'select', { options: ['Protagonista', 'Aliado', 'Antagonista', 'Coadjuvante'] }),
        codexField('Motivação', 'longtext'),
        codexField('Local principal', 'reference', { refTypeId: idLocal }),
        codexField('Ficha técnica', 'stats'),
      ] },
      { id: idFaccao, name: 'Facção', icon: 'sliders', color: '#f97316', gddSectionId: null, fields: [
        codexField('Descrição', 'longtext'),
        codexField('Território', 'reference', { refTypeId: idLocal }),
        codexField('Membros', 'reference-multi', { refTypeId: idPersonagem }),
      ] },
      { id: idItem, name: 'Item / Prop', icon: 'box', color: '#14b8a6', gddSectionId: null, fields: [
        codexField('Descrição', 'longtext'),
        codexField('Raridade', 'select', { options: ['Comum', 'Incomum', 'Raro', 'Único'] }),
      ] },
      { id: idMecanica, name: 'Mecânica', icon: 'wrench', color: '#10b981', gddSectionId: 'mechanics', fields: [
        codexField('Descrição', 'longtext'),
        codexField('Como funciona', 'longtext'),
      ] },
      { id: idNave, name: 'Nave', icon: 'rocket', color: '#3b82f6', gddSectionId: null, fields: [
        codexField('Descrição', 'longtext'),
        codexField('Tripulação', 'tags'),
      ] },
      { id: idBoss, name: 'Boss', icon: 'target', color: '#f43f5e', gddSectionId: 'enemies', fields: [
        codexField('Imagem de referência', 'image'),
        codexField('Descrição', 'longtext'),
        codexField('Local', 'reference', { refTypeId: idLocal }),
        codexField('Mecânica associada', 'reference', { refTypeId: idMecanica }),
        codexField('Recompensa', 'text'),
        codexField('Ficha técnica', 'stats'),
      ] },
      { id: idEvento, name: 'Evento / Lore', icon: 'book-open', color: '#eab308', gddSectionId: null, fields: [
        codexField('Descrição', 'longtext'),
        codexField('Personagens envolvidos', 'reference-multi', { refTypeId: idPersonagem }),
      ] },
    ];
  }

  /** Tipo de ficha pronto pra rastrear os assets que ainda faltam produzir pro jogo (NPCs,
   *  instalações, ferramentas, plantações...) — diferente dos tipos de lore acima, com campo de
   *  status pra acompanhar o andamento. Adicionado sob demanda (botão dedicado no Codex, não faz
   *  parte do "conjunto sugerido"), pra não se misturar com os tipos de worldbuilding existentes.
   *  Linka com Personagem/Local automaticamente se esses tipos já existirem no Codex do usuário. */
  function buildAssetTrackerCodexType(existingTypes) {
    var personagem = (existingTypes || []).filter(function (t) { return t.name === 'Personagem'; })[0];
    var local = (existingTypes || []).filter(function (t) { return t.name === 'Local'; })[0];
    var fields = [
      codexField('Categoria', 'select', { options: ['NPC', 'Instalação', 'Ferramenta', 'Plantação', 'Cenário', 'Outro'] }),
      codexField('Status', 'select', { options: ['A criar', 'Em produção', 'Pronto'] }),
      codexField('Imagem de referência', 'image'),
      codexField('Descrição', 'longtext'),
    ];
    if (personagem) fields.push(codexField('Personagem relacionado', 'reference', { refTypeId: personagem.id }));
    if (local) fields.push(codexField('Local relacionado', 'reference', { refTypeId: local.id }));
    return { id: makeId('type'), name: 'Asset de Produção', icon: 'box', color: '#65a30d', gddSectionId: null, fields: fields };
  }

  function createEmptyCodex() { return { types: [], entries: [] }; }

  function defaultCodexFieldValue(kind) {
    if (kind === 'tags' || kind === 'reference-multi' || kind === 'stats') return [];
    if (kind === 'checkbox') return false;
    if (kind === 'number' || kind === 'image') return null;
    return '';
  }

  function isValidCodexType(t) {
    return !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.fields);
  }

  function normalizeCodexField(raw) {
    var kind = CODEX_FIELD_KIND_IDS.indexOf(raw.kind) !== -1 ? raw.kind : 'text';
    return {
      id: typeof raw.id === 'string' ? raw.id : makeId('field'),
      label: typeof raw.label === 'string' ? raw.label : 'Campo',
      kind: kind,
      options: Array.isArray(raw.options) ? raw.options.filter(function (o) { return typeof o === 'string'; }) : [],
      refTypeId: typeof raw.refTypeId === 'string' ? raw.refTypeId : null,
    };
  }

  function normalizeCodexType(raw) {
    return {
      id: raw.id,
      name: raw.name,
      icon: typeof raw.icon === 'string' ? raw.icon : 'file-text',
      color: typeof raw.color === 'string' ? raw.color : '#94a3b8',
      gddSectionId: typeof raw.gddSectionId === 'string' ? raw.gddSectionId : null,
      fields: Array.isArray(raw.fields)
        ? raw.fields.filter(function (f) { return f && typeof f === 'object'; }).map(normalizeCodexField)
        : [],
    };
  }

  function isValidCodexEntry(e) {
    return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.typeId === 'string';
  }

  /** Preenche/normaliza os valores de campo de uma entrada de acordo com o schema atual do seu tipo
   *  (tolerante a campos removidos/renomeados do tipo desde a última vez que o projeto foi salvo). */
  function normalizeCodexEntry(raw, type) {
    var rawFields = (raw.fields && typeof raw.fields === 'object') ? raw.fields : {};
    var fields = {};
    type.fields.forEach(function (f) {
      var v = rawFields[f.id];
      if (v === undefined) { fields[f.id] = defaultCodexFieldValue(f.kind); return; }
      if (f.kind === 'tags' || f.kind === 'reference-multi') {
        fields[f.id] = Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
      } else if (f.kind === 'stats') {
        fields[f.id] = Array.isArray(v)
          ? v.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
            return {
              id: typeof r.id === 'string' ? r.id : makeId('stat'),
              label: typeof r.label === 'string' ? r.label : '',
              value: typeof r.value === 'string' ? r.value : '',
            };
          })
          : [];
      } else if (f.kind === 'checkbox') fields[f.id] = !!v;
      else if (f.kind === 'number') fields[f.id] = (typeof v === 'number' && isFinite(v)) ? v : null;
      else if (f.kind === 'image') fields[f.id] = typeof v === 'string' && v ? v : null;
      else fields[f.id] = typeof v === 'string' ? v : '';
    });
    return {
      id: raw.id,
      typeId: raw.typeId,
      name: typeof raw.name === 'string' ? raw.name : '',
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      fields: fields,
      createdAt: isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
  }

  /** Migra/normaliza o Codex, descartando entradas cujo tipo não existe mais (tipo apagado). */
  function normalizeCodex(raw) {
    var empty = createEmptyCodex();
    if (!raw || typeof raw !== 'object') return empty;
    var types = Array.isArray(raw.types) ? raw.types.filter(isValidCodexType).map(normalizeCodexType) : [];
    var typeMap = types.reduce(function (acc, t) { acc[t.id] = t; return acc; }, {});
    var entries = Array.isArray(raw.entries)
      ? raw.entries.filter(isValidCodexEntry).filter(function (e) { return !!typeMap[e.typeId]; })
        .map(function (e) { return normalizeCodexEntry(e, typeMap[e.typeId]); })
      : [];
    return { types: types, entries: entries };
  }

  var WIKI_LINK_RE = /\[\[([^\[\]]+)\]\]/g;

  /** Extrai os nomes citados como [[Nome]] num texto (sem resolver — só o texto entre colchetes). */
  function parseWikiLinkNames(text) {
    var names = [];
    if (!text) return names;
    var re = new RegExp(WIKI_LINK_RE.source, 'g');
    var m;
    while ((m = re.exec(text))) {
      var name = m[1].trim();
      if (name && names.indexOf(name) === -1) names.push(name);
    }
    return names;
  }

  function codexEntryMap(codex) { return codex.entries.reduce(function (acc, e) { acc[e.id] = e; return acc; }, {}); }
  function codexTypeMap(codex) { return codex.types.reduce(function (acc, t) { acc[t.id] = t; return acc; }, {}); }
  function codexEntriesByNameLower(codex) {
    var map = {};
    codex.entries.forEach(function (e) {
      var key = (e.name || '').trim().toLowerCase();
      if (key && !map[key]) map[key] = e;
    });
    return map;
  }

  /** Constrói o grafo de relações do Codex: nós = entradas, arestas = campos de referência + links [[Nome]]
   *  em qualquer texto longo (resumo incluso). Base tanto do painel "Relacionados" quanto da visão em grafo. */
  function buildCodexGraph(codex) {
    var typeMap = codexTypeMap(codex);
    var byName = codexEntriesByNameLower(codex);
    var edgeKeySet = {};
    var edges = [];

    function addEdge(fromId, toId, kind) {
      if (!fromId || !toId || fromId === toId) return;
      var key = [fromId, toId].sort().join('::') + '::' + kind;
      if (edgeKeySet[key]) return;
      edgeKeySet[key] = true;
      edges.push({ source: fromId, target: toId, kind: kind });
    }

    codex.entries.forEach(function (e) {
      var type = typeMap[e.typeId];
      var texts = [e.summary];
      if (type) {
        type.fields.forEach(function (f) {
          if (f.kind === 'reference' && e.fields[f.id]) addEdge(e.id, e.fields[f.id], 'reference');
          else if (f.kind === 'reference-multi' && Array.isArray(e.fields[f.id])) {
            e.fields[f.id].forEach(function (targetId) { addEdge(e.id, targetId, 'reference'); });
          } else if (f.kind === 'longtext') texts.push(e.fields[f.id]);
        });
      }
      texts.forEach(function (text) {
        parseWikiLinkNames(text).forEach(function (name) {
          var target = byName[name.trim().toLowerCase()];
          if (target) addEdge(e.id, target.id, 'link');
        });
      });
    });

    var nodes = codex.entries.map(function (e) {
      var type = typeMap[e.typeId];
      return { id: e.id, name: e.name || '(sem nome)', typeId: e.typeId, color: type ? type.color : '#94a3b8', icon: type ? type.icon : 'file-text' };
    });

    return { nodes: nodes, edges: edges };
  }

  /** Relações de uma entrada específica: referências estruturadas de saída, links [[Nome]] de saída
   *  (resolvidos quando possível) e backlinks (quem referencia/cita esta entrada). */
  function codexRelationsFor(codex, entryId) {
    var typeMap = codexTypeMap(codex);
    var entryMap = codexEntryMap(codex);
    var byName = codexEntriesByNameLower(codex);
    var out = { referencesOut: [], linksOut: [], backlinks: [] };
    var entry = entryMap[entryId];
    if (!entry) return out;
    var type = typeMap[entry.typeId];

    var longtextValues = [entry.summary];
    if (type) {
      type.fields.forEach(function (f) {
        if (f.kind === 'reference') {
          var targetId = entry.fields[f.id];
          if (targetId) out.referencesOut.push({ fieldLabel: f.label, entries: [entryMap[targetId] || null] });
        } else if (f.kind === 'reference-multi') {
          var ids = Array.isArray(entry.fields[f.id]) ? entry.fields[f.id] : [];
          if (ids.length) out.referencesOut.push({ fieldLabel: f.label, entries: ids.map(function (id) { return entryMap[id] || null; }) });
        } else if (f.kind === 'longtext') {
          longtextValues.push(entry.fields[f.id]);
        }
      });
    }

    var seen = {};
    longtextValues.forEach(function (text) {
      parseWikiLinkNames(text).forEach(function (name) {
        var key = name.trim().toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.linksOut.push({ name: name, entry: byName[key] || null });
      });
    });

    var selfNameLower = (entry.name || '').trim().toLowerCase();
    codex.entries.forEach(function (other) {
      if (other.id === entry.id) return;
      var otherType = typeMap[other.typeId];
      var via = null;
      if (otherType) {
        otherType.fields.some(function (f) {
          if (f.kind === 'reference' && other.fields[f.id] === entry.id) { via = f.label; return true; }
          if (f.kind === 'reference-multi' && Array.isArray(other.fields[f.id]) && other.fields[f.id].indexOf(entry.id) !== -1) { via = f.label; return true; }
          return false;
        });
      }
      if (!via && selfNameLower) {
        var otherTexts = [other.summary].concat(otherType
          ? otherType.fields.filter(function (f) { return f.kind === 'longtext'; }).map(function (f) { return other.fields[f.id]; })
          : []);
        var found = otherTexts.some(function (t) {
          return parseWikiLinkNames(t).some(function (n) { return n.trim().toLowerCase() === selfNameLower; });
        });
        if (found) via = '';
      }
      if (via !== null) out.backlinks.push({ entry: other, fieldLabel: via || null });
    });

    return out;
  }

  // ---------- Notas ----------
  // Anotações livres em Markdown — sem a estrutura fixa do Codex, mas usando a mesma sintaxe
  // [[Nome]] pra linkar uma entrada quando fizer sentido. É o rascunho rápido que não merece virar
  // uma ficha estruturada. Pode carregar uma única imagem de referência (guardada no imageStore).

  function isValidNote(n) {
    return !!n && typeof n === 'object' && typeof n.id === 'string';
  }

  function normalizeNote(raw) {
    return {
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      body: typeof raw.body === 'string' ? raw.body : '',
      imageId: typeof raw.imageId === 'string' && raw.imageId ? raw.imageId : null,
      createdAt: isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
  }

  function normalizeNotes(raw) {
    return Array.isArray(raw) ? raw.filter(isValidNote).map(normalizeNote) : [];
  }

  // ---------- Mural ----------
  // Mural (pinboard): post-its, imagens e um mini fluxograma (formas + setas) que o usuário organiza
  // livremente por um quadro com pan/zoom. Sem desenho à mão livre — só posicionar/redimensionar/conectar.

  var MURAL_ITEM_KINDS = ['note', 'image', 'shape', 'arrow', 'stroke'];
  // 'rect'/'diamond'/'oval' são as formas de fluxograma (processo/decisão/terminal); as demais são as
  // "formas básicas" (círculo, quadrado, triângulo, estrela, pentágono, hexágono) — mesmo motor de
  // renderização (shapeStyle), botão de toolbar separado.
  var MURAL_SHAPE_TYPES = ['rect', 'diamond', 'oval', 'circle', 'square', 'triangle', 'star', 'pentagon', 'hexagon'];
  var MURAL_ANCHORS = ['top', 'right', 'bottom', 'left', 'center'];
  // Estilo de linha de uma seta/conector: sólida com ponta (seta de verdade), tracejada ou pontilhada
  // (linhas de conexão sem seta, mesma ferramenta de clique-e-arraste).
  var MURAL_LINE_STYLES = ['solid', 'dashed', 'dotted'];
  var MURAL_STROKE_TOOLS = ['pen', 'highlighter'];
  var MURAL_NOTE_DEFAULT_COLOR = '#fbbf24';
  var MURAL_SHAPE_DEFAULT_COLOR = '#e4e4e7';
  var MURAL_ARROW_DEFAULT_COLOR = '#52525b';
  // Paleta de cor pra setas/conectores (sólida, tracejada ou pontilhada) — o cinza padrão sempre
  // primeiro, igual ao MURAL_ARROW_DEFAULT_COLOR (pedido do Renato: "as setas, tracejados e
  // pontilhados precisam de uma opção de alterar cor").
  var MURAL_LINE_COLORS = ['#52525b', '#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6'];
  var MURAL_PEN_COLORS = ['#2563eb', '#18181b', '#dc2626', '#16a34a']; // azul, preto, vermelho, verde
  var MURAL_HIGHLIGHTER_COLORS = ['#4ade80', '#fde047', '#f9a8d4', '#c084fc']; // verde, amarelo, rosa, roxo
  var MURAL_STROKE_DEFAULT_COLOR = { pen: MURAL_PEN_COLORS[1], highlighter: MURAL_HIGHLIGHTER_COLORS[1] };

  // Sanitização da formatação básica de texto (negrito/itálico/sublinhado/lista/tamanho) digitada nos
  // post-its e formas — roda ao normalizar (carregar do storage ou importar um JSON), não a cada tecla,
  // pra não atrapalhar o cursor durante a digitação. Cobre tanto conteúdo colado quanto um backup
  // editado à mão: nunca deixa passar tag ou atributo fora da lista branca.
  var RICH_TEXT_ALLOWED_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1, SPAN: 1, DIV: 1, P: 1 };
  var RICH_TEXT_STRIP_ENTIRELY = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1 };
  var RICH_TEXT_FONT_SIZE_RE = /^\s*font-size\s*:\s*(\d{1,3})px\s*;?\s*$/i;

  function sanitizeRichText(html) {
    if (typeof html !== 'string' || !html) return '';
    if (typeof DOMParser === 'undefined') return '';
    var parsed;
    try { parsed = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'); } catch (e) { return ''; }
    var root = parsed && parsed.body && parsed.body.firstChild;
    if (!root) return '';
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) return; // nó de texto: mantém
        if (child.nodeType !== 1) { node.removeChild(child); return; }
        var tag = child.tagName;
        if (RICH_TEXT_STRIP_ENTIRELY[tag]) { node.removeChild(child); return; }
        if (!RICH_TEXT_ALLOWED_TAGS[tag]) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        Array.prototype.slice.call(child.attributes).forEach(function (attr) {
          if (attr.name === 'style') {
            var m = RICH_TEXT_FONT_SIZE_RE.exec(attr.value);
            if (m) { child.setAttribute('style', 'font-size:' + m[1] + 'px'); return; }
          }
          child.removeAttribute(attr.name);
        });
        clean(child);
      });
    }(root));
    return root.innerHTML;
  }

  function isValidMuralItem(it) {
    return !!it && typeof it === 'object' && typeof it.id === 'string' && MURAL_ITEM_KINDS.indexOf(it.kind) !== -1;
  }

  function normalizeMuralItem(raw) {
    var kind = MURAL_ITEM_KINDS.indexOf(raw.kind) !== -1 ? raw.kind : 'note';
    var strokeTool = MURAL_STROKE_TOOLS.indexOf(raw.tool) !== -1 ? raw.tool : 'pen';
    var defaultColor = kind === 'shape' ? MURAL_SHAPE_DEFAULT_COLOR : kind === 'arrow' ? MURAL_ARROW_DEFAULT_COLOR :
      kind === 'stroke' ? MURAL_STROKE_DEFAULT_COLOR[strokeTool] : MURAL_NOTE_DEFAULT_COLOR;
    var item = {
      id: raw.id,
      kind: kind,
      x: isFinite(raw.x) ? raw.x : 0,
      y: isFinite(raw.y) ? raw.y : 0,
      w: isFinite(raw.w) ? raw.w : (kind === 'image' ? 220 : kind === 'shape' ? 160 : 190),
      h: isFinite(raw.h) ? raw.h : (kind === 'image' ? 160 : kind === 'shape' ? 100 : 150),
      text: (kind === 'note' || kind === 'shape') ? sanitizeRichText(typeof raw.text === 'string' ? raw.text : '') : '',
      color: typeof raw.color === 'string' ? raw.color : defaultColor,
      imageId: typeof raw.imageId === 'string' && raw.imageId ? raw.imageId : null,
      caption: typeof raw.caption === 'string' ? raw.caption : '',
      linkedEntryId: typeof raw.linkedEntryId === 'string' && raw.linkedEntryId ? raw.linkedEntryId : null,
      createdAt: isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
    if (kind === 'shape') {
      item.shapeType = MURAL_SHAPE_TYPES.indexOf(raw.shapeType) !== -1 ? raw.shapeType : 'rect';
    }
    if (kind === 'arrow') {
      item.x1 = isFinite(raw.x1) ? raw.x1 : 0;
      item.y1 = isFinite(raw.y1) ? raw.y1 : 0;
      item.x2 = isFinite(raw.x2) ? raw.x2 : 120;
      item.y2 = isFinite(raw.y2) ? raw.y2 : 0;
      item.fromItemId = typeof raw.fromItemId === 'string' && raw.fromItemId ? raw.fromItemId : null;
      item.fromAnchor = MURAL_ANCHORS.indexOf(raw.fromAnchor) !== -1 ? raw.fromAnchor : 'center';
      item.toItemId = typeof raw.toItemId === 'string' && raw.toItemId ? raw.toItemId : null;
      item.toAnchor = MURAL_ANCHORS.indexOf(raw.toAnchor) !== -1 ? raw.toAnchor : 'center';
      item.lineStyle = MURAL_LINE_STYLES.indexOf(raw.lineStyle) !== -1 ? raw.lineStyle : 'solid';
    }
    if (kind === 'stroke') {
      // Traço de desenho livre (pincel/marca-texto): guarda a lista de pontos em coordenadas absolutas
      // do quadro — não é arrastável/redimensionável (só selecionável e excluível), então x/y/w/h
      // servem apenas de caixa delimitadora pro marquee e pra o hit-test de clique selecionar o traço.
      item.tool = strokeTool;
      item.points = Array.isArray(raw.points)
        ? raw.points.filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); }).map(function (p) { return { x: p.x, y: p.y }; })
        : [];
      item.strokeWidth = isFinite(raw.strokeWidth) ? raw.strokeWidth : (strokeTool === 'highlighter' ? 14 : 3);
    }
    return item;
  }

  function createEmptyMural() { return { items: [] }; }

  function normalizeMural(raw) {
    if (!raw || typeof raw !== 'object') return createEmptyMural();
    return { items: Array.isArray(raw.items) ? raw.items.filter(isValidMuralItem).map(normalizeMuralItem) : [] };
  }

  // ---------- Árvore de Habilidades ----------
  // Ferramenta de design (não é o que roda dentro do jogo do usuário — é onde ele planeja a árvore,
  // igual o Quest Designer planeja missões) — pedido do Renato: layout em camadas (tier = 1 + maior
  // tier entre os pré-requisitos, raízes na camada 0), não um canvas livre feito o Mural. Ramos/
  // categorias são livres (sem semente padrão, ao contrário das categorias do Kanban — o "gênero" de
  // uma árvore de habilidades varia demais de projeto pra projeto pra chutar um conjunto genérico).
  var SKILL_TREE_ICONS = [
    'star', 'target', 'flag', 'shapes', 'sparkles', 'trending-up', 'layers',
    'workflow', 'box', 'crosshair', 'gamepad-2', 'book-open', 'tag', 'check',
  ];

  function isValidSkillBranch(b) {
    return !!b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string';
  }

  function normalizeSkillBranch(raw) {
    return {
      id: raw.id,
      name: raw.name,
      color: typeof raw.color === 'string' && raw.color ? raw.color : MILESTONE_COLOR_PALETTE[0],
      icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : 'star',
    };
  }

  function isValidSkillNode(n) {
    return !!n && typeof n === 'object' && typeof n.id === 'string';
  }

  function normalizeSkillNode(raw) {
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : '',
      description: typeof raw.description === 'string' ? raw.description : '',
      icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : 'star',
      cost: isFinite(raw.cost) ? Math.max(0, raw.cost) : 1,
      // Cor própria opcional (mesmo padrão do card do Kanban: null = herda a cor do ramo, ou o cinza
      // padrão se também não tiver ramo — só grava algo aqui quando o usuário escolhe substituir).
      color: typeof raw.color === 'string' ? raw.color : null,
      branchId: typeof raw.branchId === 'string' && raw.branchId ? raw.branchId : null,
      prereqIds: Array.isArray(raw.prereqIds) ? raw.prereqIds.filter(function (id) { return typeof id === 'string'; }) : [],
      linkedEntryId: typeof raw.linkedEntryId === 'string' && raw.linkedEntryId ? raw.linkedEntryId : null,
      linkedQuestId: typeof raw.linkedQuestId === 'string' && raw.linkedQuestId ? raw.linkedQuestId : null,
      createdAt: isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
  }

  function createEmptySkillTree() { return { branches: [], nodes: [] }; }

  /** Além de preencher campos ausentes, descarta referências penduradas (branchId/prereqIds
   *  apontando pra algo que não existe mais) — pode acontecer numa importação parcial/editada à mão. */
  function normalizeSkillTree(raw) {
    if (!raw || typeof raw !== 'object') return createEmptySkillTree();
    var branches = Array.isArray(raw.branches) ? raw.branches.filter(isValidSkillBranch).map(normalizeSkillBranch) : [];
    var branchIds = {};
    branches.forEach(function (b) { branchIds[b.id] = true; });
    var nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isValidSkillNode).map(normalizeSkillNode) : [];
    var nodeIds = {};
    nodes.forEach(function (n) { nodeIds[n.id] = true; });
    nodes = nodes.map(function (n) {
      return Object.assign({}, n, {
        branchId: n.branchId && branchIds[n.branchId] ? n.branchId : null,
        prereqIds: n.prereqIds.filter(function (id) { return id !== n.id && nodeIds[id]; }),
      });
    });
    return { branches: branches, nodes: nodes };
  }

  // ---------- Direção de arte (js/ui/artDirection.js) ----------
  // Entidade de 1ª classe (aditiva, sem bump de schema): visão geral + paletas + estilos.
  // paleta = { id, name, notes, codexIds, colors: [{ id, name, hex, role }] }
  // estilo = { id, name, concept, elements[], materials[], interfaces, dos[], donts[], paletteId,
  //            imageIds[], codexIds }
  var ART_COLOR_ROLES = ['Base', 'Secundária', 'Destaque', 'Sombra', 'Luz', 'Interface', 'Perigo'];

  function createEmptyArtDirection() { return { overview: '', palettes: [], styles: [] }; }

  function artStr(v, max) { return typeof v === 'string' ? v.slice(0, max || 20000) : ''; }
  function artList(v, max) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.slice(0, max || 300); }).slice(0, 200) : [];
  }
  function normalizeArtColor(c) {
    if (!c || typeof c !== 'object') return null;
    var hex = typeof c.hex === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex.toLowerCase() : null;
    if (!hex) return null;
    return { id: typeof c.id === 'string' && c.id ? c.id : makeId('col'), name: artStr(c.name, 80), hex: hex, role: ART_COLOR_ROLES.indexOf(c.role) !== -1 ? c.role : '' };
  }
  function normalizeArtDirection(raw) {
    var out = createEmptyArtDirection();
    if (!raw || typeof raw !== 'object') return out;
    out.overview = artStr(raw.overview);
    out.palettes = (Array.isArray(raw.palettes) ? raw.palettes : []).filter(function (p) { return p && typeof p.id === 'string'; }).slice(0, 200).map(function (p) {
      return { id: p.id, name: artStr(p.name, 120), notes: artStr(p.notes, 4000), codexIds: artList(p.codexIds),
        colors: (Array.isArray(p.colors) ? p.colors : []).map(normalizeArtColor).filter(Boolean).slice(0, 40) };
    });
    var palIds = {};
    out.palettes.forEach(function (p) { palIds[p.id] = true; });
    out.styles = (Array.isArray(raw.styles) ? raw.styles : []).filter(function (st) { return st && typeof st.id === 'string'; }).slice(0, 200).map(function (st) {
      return { id: st.id, name: artStr(st.name, 120), concept: artStr(st.concept), elements: artList(st.elements), materials: artList(st.materials),
        interfaces: artStr(st.interfaces, 4000), dos: artList(st.dos, 500), donts: artList(st.donts, 500),
        paletteId: typeof st.paletteId === 'string' && palIds[st.paletteId] ? st.paletteId : null,
        imageIds: artList(st.imageIds, 200), codexIds: artList(st.codexIds) };
    });
    return out;
  }

  // ---------- Atlas: mapas de mundo e plantas radiais (js/ui/atlas.js) ----------
  // Entidade de 1ª classe, aditiva: doc.atlas = { maps: [...], activeId }. kind 'world' = mapa livre
  // com terreno pintado (traços com textura), carimbos, rótulos, regiões, caminhos, rosa dos ventos e
  // grade com coordenadas; kind 'radial' = planta circular (anéis divididos em setores + ramais
  // radiais), com as mesmas camadas por cima. Coordenadas em "unidades de mundo"; world = (0,0) no
  // canto superior esquerdo até (width,height); radial = centro em (0,0), raio R.
  var ATLAS_LAYER_IDS = ['terrain', 'structure', 'regions', 'paths', 'stamps', 'labels', 'decor'];
  var ATLAS_MAX = { maps: 60, strokes: 6000, points: 4000, items: 3000, rings: 12, sectors: 48 };

  function createEmptyAtlas() { return { maps: [], activeId: null }; }

  function aNum(v, min, max, def) { var n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, n)) : def; }
  function aStr(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }
  function aColor(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
  function aId(v, prefix) { return typeof v === 'string' && v ? v.slice(0, 80) : makeId(prefix); }
  function aPts(v, maxPts) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i + 1 < v.length && out.length < maxPts * 2; i += 2) {
      var x = Number(v[i]), y = Number(v[i + 1]);
      if (isFinite(x) && isFinite(y)) out.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
    }
    return out;
  }

  function normalizeAtlasMap(raw) {
    var kind = raw && (raw.kind === 'radial' || raw.kind === 'hex') ? raw.kind : 'world';
    var m = {
      id: aId(raw && raw.id, 'atlas'), name: aStr(raw && raw.name, 80) || (kind === 'radial' ? 'Planta radial' : 'Mapa de mundo'), kind: kind,
      style: ['wasteland', 'parchment', 'blueprint', 'dark'].indexOf(raw && raw.style) !== -1 ? raw.style : 'wasteland',
      width: aNum(raw && raw.width, 200, 40000, 3000), height: aNum(raw && raw.height, 200, 40000, 2000),
      strokes: [], stamps: [], labels: [], regions: [], paths: [],
      compass: { on: true, x: 0, y: 0, size: 140 },
      grid: { on: true, cell: 200, labels: true },
      layers: {},
      radial: null,
    };
    if (!raw || typeof raw !== 'object') raw = {};
    var c = raw.compass || {};
    m.compass = { on: c.on !== false, x: aNum(c.x, -40000, 40000, kind === 'radial' ? 0 : m.width - 220), y: aNum(c.y, -40000, 40000, kind === 'radial' ? 0 : 220), size: aNum(c.size, 20, 2000, 140) };
    var g = raw.grid || {};
    m.grid = { on: g.on !== undefined ? !!g.on : kind === 'world', cell: aNum(g.cell, 10, 5000, 200), labels: g.labels !== false, shape: g.shape === 'hex' ? 'hex' : 'square' };
    m.strokes = (Array.isArray(raw.strokes) ? raw.strokes : []).slice(0, ATLAS_MAX.strokes).map(function (st) {
      if (!st || typeof st !== 'object') return null;
      var pts = aPts(st.p, ATLAS_MAX.points);
      if (pts.length < 2) return null;
      var out = { id: aId(st.id, 'st'), t: aStr(st.t, 30) || 'sand', s: aNum(st.s, 1, 2000, 60), p: pts };
      if (Number(st.o) > 0 && Number(st.o) < 1) out.o = aNum(st.o, 0.05, 1, 1); // opacidade (rev. 2)
      // balde: máscara RLE (ver atlas.js computeFill)
      var f = st.fill;
      if (f && typeof f === 'object') {
        var fw = Math.round(Number(f.w)), fh = Math.round(Number(f.h)), fr = Number(f.r);
        if (!(fw > 0 && fh > 0 && fw * fh <= 400000 && fr > 0 && typeof f.d === 'string' && /^[0-9a-z,]*$/.test(f.d) && f.d.length < 2000000)) return null;
        out.fill = { x: aNum(f.x, -40000, 80000, 0), y: aNum(f.y, -40000, 80000, 0), w: fw, h: fh, r: aNum(fr, 1, 500, 8), d: f.d };
      }
      return out;
    }).filter(Boolean);
    m.stamps = (Array.isArray(raw.stamps) ? raw.stamps : []).slice(0, ATLAS_MAX.items).map(function (st) {
      if (!st || typeof st !== 'object') return null;
      return { id: aId(st.id, 'sp'), k: aStr(st.k, 30) || 'mountain', x: aNum(st.x, -40000, 80000, 0), y: aNum(st.y, -40000, 80000, 0),
        s: aNum(st.s, 0.1, 50, 1), r: aNum(st.r, -360, 360, 0), c: aColor(st.c),
        imageId: typeof st.imageId === 'string' && st.imageId ? st.imageId : null,
        o: Number(st.o) > 0 && Number(st.o) < 1 ? aNum(st.o, 0.05, 1, 1) : undefined };
    }).filter(Boolean);
    m.labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, ATLAS_MAX.items).map(function (l) {
      if (!l || typeof l !== 'object' || !aStr(l.text, 120).trim()) return null;
      return { id: aId(l.id, 'lb'), text: aStr(l.text, 120), x: aNum(l.x, -40000, 80000, 0), y: aNum(l.y, -40000, 80000, 0),
        style: ['region', 'place', 'small'].indexOf(l.style) !== -1 ? l.style : 'place', size: aNum(l.size, 0.2, 10, 1),
        curve: aNum(l.curve, -1, 1, 0), r: aNum(l.r, -360, 360, 0), c: aColor(l.c) };
    }).filter(Boolean);
    m.regions = (Array.isArray(raw.regions) ? raw.regions : []).slice(0, ATLAS_MAX.items).map(function (r) {
      if (!r || typeof r !== 'object') return null;
      var pts = aPts(r.pts, 400);
      if (pts.length < 6) return null;
      return { id: aId(r.id, 'rg'), name: aStr(r.name, 80), pts: pts, c: aColor(r.c) || '#dc2626', dash: r.dash !== false };
    }).filter(Boolean);
    m.paths = (Array.isArray(raw.paths) ? raw.paths : []).slice(0, ATLAS_MAX.items).map(function (pa) {
      if (!pa || typeof pa !== 'object') return null;
      var pts = aPts(pa.pts, 800);
      if (pts.length < 4) return null;
      return { id: aId(pa.id, 'pa'), name: aStr(pa.name, 80), pts: pts, kind: ['road', 'trail', 'river', 'border'].indexOf(pa.kind) !== -1 ? pa.kind : 'road' };
    }).filter(Boolean);
    ATLAS_LAYER_IDS.forEach(function (id) {
      var l = raw.layers && raw.layers[id];
      m.layers[id] = { visible: !(l && l.visible === false), locked: !!(l && l.locked) };
    });
    if (kind === 'radial') {
      var rd = raw.radial || {};
      var rings = (Array.isArray(rd.rings) ? rd.rings : []).slice(0, ATLAS_MAX.rings).map(function (rg, i) {
        if (!rg || typeof rg !== 'object') return null;
        var n = Math.round(aNum(rg.sectors, 1, ATLAS_MAX.sectors, 1));
        var cells = (Array.isArray(rg.cells) ? rg.cells : []).slice(0, ATLAS_MAX.sectors).map(function (ce) {
          return { name: aStr(ce && ce.name, 80), c: aColor(ce && ce.c) };
        });
        while (cells.length < n) cells.push({ name: '', c: null });
        return { id: aId(rg.id, 'ring'), name: aStr(rg.name, 80), r0: aNum(rg.r0, 0, 1, 0), r1: aNum(rg.r1, 0, 1, 1), sectors: n,
          offset: aNum(rg.offset, -360, 360, 0), c: aColor(rg.c), cells: cells.slice(0, n) };
      }).filter(Boolean);
      rings.forEach(function (rg) { if (rg.r1 < rg.r0) { var t = rg.r0; rg.r0 = rg.r1; rg.r1 = t; } });
      var sp = rd.spokes || {};
      m.radial = {
        R: aNum(rd.R, 50, 20000, 1000),
        rings: rings,
        spokes: { count: Math.round(aNum(sp.count, 0, 48, 0)), offset: aNum(sp.offset, -360, 360, 0), r0: aNum(sp.r0, 0, 1, 0.2), r1: aNum(sp.r1, 0, 1.2, 1),
          width: aNum(sp.width, 1, 2000, 30), name: aStr(sp.name, 60) },
        dome: rd.dome !== false,
      };
    }
    if (kind === 'hex') {
      // Tileset hexagonal: grade de cols×rows hexágonos ("pointy" = linhas ímpares deslocadas;
      // "flat" = colunas ímpares deslocadas), `size` = distância entre lados paralelos.
      // tiles["c,r"] = id da peça; notes["c,r"] = nota do hexágono. Tileset por mapa: peça de
      // textura pronta (`terrain`), cor sólida (`color`) ou imagem do imageStore (`imageId`).
      var hx = raw.hex || {};
      var cols = Math.round(aNum(hx.cols, 1, 200, 24)), rows = Math.round(aNum(hx.rows, 1, 200, 18));
      var tileset = (Array.isArray(raw.tileset) ? raw.tileset : []).slice(0, 200).map(function (t) {
        if (!t || typeof t !== 'object') return null;
        var tid = aId(t.id, 'tile');
        var img = typeof t.imageId === 'string' && t.imageId ? t.imageId : null;
        return { id: tid, name: aStr(t.name, 60) || 'Peça', terrain: img ? null : (aStr(t.terrain, 30) || null), color: aColor(t.color), imageId: img };
      }).filter(Boolean);
      var tileIds = {};
      tileset.forEach(function (t) { tileIds[t.id] = true; });
      var inGrid = function (k) {
        var p = /^(\d+),(\d+)$/.exec(k);
        return p && Number(p[1]) < cols && Number(p[2]) < rows;
      };
      var tiles = {}, notes = {};
      if (hx.tiles && typeof hx.tiles === 'object') Object.keys(hx.tiles).forEach(function (k) { if (inGrid(k) && tileIds[hx.tiles[k]]) tiles[k] = hx.tiles[k]; });
      if (hx.notes && typeof hx.notes === 'object') Object.keys(hx.notes).forEach(function (k) { var n = aStr(hx.notes[k], 2000); if (inGrid(k) && n.trim()) notes[k] = n; });
      m.hex = {
        cols: cols, rows: rows, size: aNum(hx.size, 10, 2000, 120), orient: hx.orient === 'flat' ? 'flat' : 'pointy',
        lines: hx.lines !== false, coordsIn: !!hx.coordsIn, tiles: tiles, notes: notes,
      };
      m.tileset = tileset;
      if (!raw.grid) m.grid.on = false; // a própria malha já é a grade; a grade quadrada fica desligada
    }
    return m;
  }

  function normalizeAtlas(raw) {
    var out = createEmptyAtlas();
    if (!raw || typeof raw !== 'object') return out;
    var seen = {};
    out.maps = (Array.isArray(raw.maps) ? raw.maps : []).slice(0, ATLAS_MAX.maps).map(normalizeAtlasMap)
      .filter(function (m) { if (seen[m.id]) return false; seen[m.id] = true; return true; });
    out.activeId = typeof raw.activeId === 'string' && seen[raw.activeId] ? raw.activeId : (out.maps[0] ? out.maps[0].id : null);
    return out;
  }

  // ---------- Documento / Projeto ----------

  function createEmptyKanban() {
    return {
      cards: [], trash: [],
      categories: DEFAULT_KANBAN_CATEGORIES.map(function (c) { return Object.assign({}, c); }),
    };
  }

  /** Devolve o conjunto de campos/seções do GDC/GDD apropriado pro tipo de projeto. */
  function emptySectionsFor(type) {
    return normalizeProjectType(type) === 'boardgame' ? BOARDGAME_EMPTY_SECTIONS : EMPTY_SECTIONS;
  }
  // ---------- Layout do GDD (seções/grupos personalizáveis por projeto) ----------
  // As funções abaixo aceitam o TIPO do projeto (string) ou o DOCUMENTO inteiro. Com o documento, se
  // ele tiver `gddLayout` (o usuário personalizou as seções), o layout dele vale; senão, o padrão do
  // tipo. `gddLayout = { groups: [{ id, label, sections: [{ id, label, placeholder, minChars, color }] }] }`
  // — guarda a ESTRUTURA inteira (não um diff do padrão), pra que renomear/remover/reordenar uma seção
  // padrão funcione sem regra especial. null = nunca personalizado. Campo aditivo, sem bump de schema.

  var GDD_SECTION_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6', '#f43f5e', '#6366f1', '#84cc16', '#6b7280'];
  var GDD_CUSTOM_MIN_CHARS = 20;

  /** Grupo sugerido de narrativa (o GDD padrão de jogo digital não tem um) — oferecido como botão no
   *  modo de edição, nunca injetado: mudar o padrão derrubaria a % da Saúde de todo projeto existente. */
  var NARRATIVE_GROUP_PRESET = {
    label: 'Narrativa',
    sections: [
      { label: 'Sinopse', placeholder: 'A história em um parágrafo: quem, onde, o que está em jogo.', minChars: 40, color: '#a855f7' },
      { label: 'História e Lore', placeholder: 'O passado do mundo, o que aconteceu antes do jogo começar.', minChars: 40, color: '#8b5cf6' },
      { label: 'Estrutura Narrativa', placeholder: 'Arcos/atos, como a história avança e o que cada parte revela.', minChars: 30, color: '#7c3aed' },
      { label: 'Temas', placeholder: 'Quais ideias o jogo explora? (ex.: legado, sobrevivência, conhecimento vs. perigo)', minChars: 15, color: '#c084fc' },
    ],
  };

  function defaultLayoutFor(type) {
    var t = normalizeProjectType(type);
    var groups = t === 'boardgame' ? BOARDGAME_GROUPS : GROUPS;
    var map = t === 'boardgame' ? BOARDGAME_SECTION_MAP : SECTION_MAP;
    return {
      groups: groups.map(function (g) {
        return {
          id: g.id, label: g.label,
          sections: g.sectionIds.map(function (id) {
            var s = map[id];
            return { id: s.id, label: s.label, placeholder: s.placeholder, minChars: s.minChars, color: s.color };
          }),
        };
      }),
    };
  }

  function normalizeGddSection(raw, idx) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    return {
      id: raw.id,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : 'Seção',
      placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : '',
      minChars: isFinite(raw.minChars) ? Math.max(0, Math.min(5000, Math.round(raw.minChars))) : GDD_CUSTOM_MIN_CHARS,
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : GDD_SECTION_COLORS[idx % GDD_SECTION_COLORS.length],
    };
  }

  /** null = sem personalização (usa o padrão do tipo). Descarta seções com id repetido (a 2ª perde). */
  function normalizeGddLayout(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups)) return null;
    var seen = {}, seq = 0;
    var groups = raw.groups.filter(function (g) { return g && typeof g === 'object' && typeof g.id === 'string' && g.id; })
      .map(function (g) {
        return {
          id: g.id,
          label: typeof g.label === 'string' && g.label.trim() ? g.label : 'Grupo',
          sections: (Array.isArray(g.sections) ? g.sections : []).map(function (s) { return normalizeGddSection(s, seq++); })
            .filter(function (s) { if (!s || seen[s.id]) return false; seen[s.id] = true; return true; }),
        };
      });
    return { groups: groups };
  }

  function layoutOf(typeOrDoc) {
    if (typeOrDoc && typeof typeOrDoc === 'object') {
      return typeOrDoc.gddLayout || defaultLayoutFor(typeOrDoc.projectType);
    }
    return defaultLayoutFor(typeOrDoc);
  }

  // Cache por objeto de layout: builder/preview/markdown chamam essas funções a cada tecla.
  var derivedCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var defaultDerived = {};
  function derive(typeOrDoc) {
    var isCustom = typeOrDoc && typeof typeOrDoc === 'object' && typeOrDoc.gddLayout;
    var cacheKey = !isCustom ? normalizeProjectType(typeOrDoc && typeof typeOrDoc === 'object' ? typeOrDoc.projectType : typeOrDoc) : null;
    if (cacheKey && defaultDerived[cacheKey]) return defaultDerived[cacheKey];
    if (isCustom && derivedCache && derivedCache.has(typeOrDoc.gddLayout)) return derivedCache.get(typeOrDoc.gddLayout);
    var layout = layoutOf(typeOrDoc);
    var sections = [], map = {};
    var groups = layout.groups.map(function (g) {
      g.sections.forEach(function (s) {
        var meta = { id: s.id, group: g.id, label: s.label, placeholder: s.placeholder, minChars: s.minChars, color: s.color };
        sections.push(meta); map[s.id] = meta;
      });
      return { id: g.id, label: g.label, sectionIds: g.sections.map(function (s) { return s.id; }) };
    });
    var result = { sections: sections, map: map, groups: groups };
    if (cacheKey) defaultDerived[cacheKey] = result;
    else if (derivedCache) derivedCache.set(typeOrDoc.gddLayout, result);
    return result;
  }

  function sectionsFor(typeOrDoc) { return derive(typeOrDoc).sections; }
  function sectionMapFor(typeOrDoc) { return derive(typeOrDoc).map; }
  function groupsFor(typeOrDoc) { return derive(typeOrDoc).groups; }

  /** Cópia editável do layout atual do documento (o padrão, se ainda não personalizado). */
  function cloneGddLayout(doc) {
    return JSON.parse(JSON.stringify(layoutOf(doc)));
  }
  function templatesFor(type) {
    return normalizeProjectType(type) === 'boardgame' ? BOARDGAME_TEMPLATES : GENRE_TEMPLATES;
  }

  function createEmptyDocument(type) {
    var t = normalizeProjectType(type);
    return {
      schemaVersion: SCHEMA_VERSION,
      projectType: t,
      title: '',
      sections: Object.assign({}, emptySectionsFor(t)),
      template: null,
      gddLayout: null,
      kanban: createEmptyKanban(),
      tools: Object.assign({}, EMPTY_TOOLS),
      codex: createEmptyCodex(),
      notes: [],
      mural: createEmptyMural(),
      skillTree: createEmptySkillTree(),
      levels: createEmptyLevels(),
      artDirection: createEmptyArtDirection(),
      atlas: createEmptyAtlas(),
    };
  }

  // ---------- Mapas (planta de fase top-down — js/ui/levelPlanner.js) ----------
  // Entidade de 1ª classe (não string solta em doc.tools) porque é uma aba própria e tem estrutura
  // rica. Grade quadrada esparsa: só as células com piso existem em `cells` ("x,y" -> tipo). Paredes
  // externas NÃO são guardadas — saem do contorno do piso na hora de desenhar (ideia do Dungeon
  // Scrawl); `walls` guarda só paredes internas, em arestas da grade. Aresta "x,y,h" = segmento
  // horizontal de (x,y) a (x+1,y), separa as células (x,y-1) e (x,y); "x,y,v" = segmento vertical de
  // (x,y) a (x,y+1), separa (x-1,y) e (x,y). Campo novo e aditivo: SCHEMA_VERSION não muda (doc
  // antigo sem `levels` só ganha a lista vazia).
  var LEVEL_FLOOR_TYPES = ['room', 'corridor', 'water', 'danger', 'secret'];
  var LEVEL_DOOR_TYPES = ['door', 'locked', 'secret', 'gate'];
  var LEVEL_MARKER_KINDS = ['start', 'goal', 'checkpoint', 'decision', 'enemy', 'boss', 'encounter', 'obstacle', 'item', 'key', 'npc', 'secret'];
  var LEVEL_PATH_KINDS = ['main', 'alt', 'secret'];
  var LEVEL_LAYER_IDS = ['layout', 'flow', 'gameplay', 'review'];
  var LEVEL_COORD_MAX = 1000;
  var LEVEL_MAX_CELLS = 60000;
  var LEVEL_MAX_ITEMS = 2000;
  var CELL_KEY_RE = /^-?\d+,-?\d+$/;
  var EDGE_KEY_RE = /^-?\d+,-?\d+,[hv]$/;

  function levelNum(v, max) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(-max, Math.min(max, n));
  }
  function levelStr(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

  function createEmptyLevelMap(name) {
    var layers = {};
    LEVEL_LAYER_IDS.forEach(function (id) { layers[id] = { visible: true, locked: false }; });
    return {
      id: makeId('map'), name: name || 'Fase 1', notes: '', style: 'sketch',
      cells: {}, walls: {}, doors: {}, markers: [], paths: [], labels: [], pins: [], props: [], layers: layers,
    };
  }

  function createEmptyLevels() { return { maps: [], activeId: null }; }

  function normalizeLevelMap(raw) {
    var m = createEmptyLevelMap();
    if (!raw || typeof raw !== 'object') return m;
    if (typeof raw.id === 'string' && raw.id) m.id = raw.id;
    m.name = levelStr(raw.name, 60) || 'Fase';
    m.notes = levelStr(raw.notes, 5000);
    m.style = ['sketch', 'sketch-dark', 'blueprint'].indexOf(raw.style) !== -1 ? raw.style : 'sketch';
    var count = 0;
    Object.keys(raw.cells || {}).forEach(function (k) {
      if (count >= LEVEL_MAX_CELLS || !CELL_KEY_RE.test(k)) return;
      var t = raw.cells[k];
      if (LEVEL_FLOOR_TYPES.indexOf(t) === -1) return;
      m.cells[k] = t; count++;
    });
    Object.keys(raw.walls || {}).forEach(function (k) { if (EDGE_KEY_RE.test(k) && raw.walls[k]) m.walls[k] = 1; });
    Object.keys(raw.doors || {}).forEach(function (k) {
      if (EDGE_KEY_RE.test(k) && LEVEL_DOOR_TYPES.indexOf(raw.doors[k]) !== -1) m.doors[k] = raw.doors[k];
    });
    m.markers = (Array.isArray(raw.markers) ? raw.markers : []).slice(0, LEVEL_MAX_ITEMS)
      .filter(function (mk) { return mk && LEVEL_MARKER_KINDS.indexOf(mk.kind) !== -1; })
      .map(function (mk) {
        return { id: typeof mk.id === 'string' ? mk.id : makeId('mk'), kind: mk.kind,
          x: Math.round(levelNum(mk.x, LEVEL_COORD_MAX)), y: Math.round(levelNum(mk.y, LEVEL_COORD_MAX)),
          label: levelStr(mk.label, 60), note: levelStr(mk.note, 1000) };
      });
    m.paths = (Array.isArray(raw.paths) ? raw.paths : []).slice(0, LEVEL_MAX_ITEMS)
      .filter(function (p) { return p && Array.isArray(p.points) && p.points.length >= 2; })
      .map(function (p) {
        return { id: typeof p.id === 'string' ? p.id : makeId('pt'),
          kind: LEVEL_PATH_KINDS.indexOf(p.kind) !== -1 ? p.kind : 'main',
          label: levelStr(p.label, 60),
          points: p.points.slice(0, 200).filter(function (pt) { return Array.isArray(pt) && pt.length === 2; })
            .map(function (pt) { return [levelNum(pt[0], LEVEL_COORD_MAX), levelNum(pt[1], LEVEL_COORD_MAX)]; }) };
      })
      .filter(function (p) { return p.points.length >= 2; });
    m.labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, LEVEL_MAX_ITEMS)
      .filter(function (l) { return l && typeof l.text === 'string' && l.text.trim(); })
      .map(function (l) {
        return { id: typeof l.id === 'string' ? l.id : makeId('lb'), text: l.text.slice(0, 80),
          x: levelNum(l.x, LEVEL_COORD_MAX), y: levelNum(l.y, LEVEL_COORD_MAX),
          size: [0.7, 1, 1.5, 2].indexOf(Number(l.size)) !== -1 ? Number(l.size) : 1,
          layer: l.layer === 'review' ? 'review' : 'layout' };
      });
    m.pins = (Array.isArray(raw.pins) ? raw.pins : []).slice(0, LEVEL_MAX_ITEMS)
      .filter(function (p) { return p && typeof p === 'object'; })
      .map(function (p) {
        return { id: typeof p.id === 'string' ? p.id : makeId('pn'),
          x: levelNum(p.x, LEVEL_COORD_MAX), y: levelNum(p.y, LEVEL_COORD_MAX),
          note: levelStr(p.note, 2000), done: !!p.done };
      });
    // Carimbos de cenário (mobília/props top-down, camada Layout): posição livre em unidades de célula
    // (centro), escala s em células, giro r em graus; k = id da biblioteca ou 'image' (imageStore).
    // São só visuais — não entram na checagem de alcance (obstáculo de gameplay continua sendo marcador).
    m.props = (Array.isArray(raw.props) ? raw.props : []).slice(0, LEVEL_MAX_ITEMS)
      .filter(function (pr) { return pr && typeof pr.k === 'string' && /^[a-z-]{1,20}$/.test(pr.k); })
      .map(function (pr) {
        var img = pr.k === 'image' && typeof pr.imageId === 'string' && pr.imageId ? pr.imageId : null;
        return { id: typeof pr.id === 'string' ? pr.id : makeId('pr'), k: img ? 'image' : (pr.k === 'image' ? 'crate' : pr.k),
          x: levelNum(pr.x, LEVEL_COORD_MAX), y: levelNum(pr.y, LEVEL_COORD_MAX),
          s: Math.max(0.25, Math.min(12, Number(pr.s) || 1)), r: ((Math.round(Number(pr.r) || 0) % 360) + 360) % 360,
          label: levelStr(pr.label, 60), imageId: img };
      });
    LEVEL_LAYER_IDS.forEach(function (id) {
      var l = raw.layers && raw.layers[id];
      if (l && typeof l === 'object') m.layers[id] = { visible: l.visible !== false, locked: !!l.locked };
    });
    return m;
  }

  function normalizeLevels(raw) {
    var out = createEmptyLevels();
    if (!raw || typeof raw !== 'object') return out;
    var seen = {};
    out.maps = (Array.isArray(raw.maps) ? raw.maps : []).slice(0, 100).map(normalizeLevelMap)
      .filter(function (m) { if (seen[m.id]) return false; seen[m.id] = true; return true; });
    out.activeId = (typeof raw.activeId === 'string' && seen[raw.activeId]) ? raw.activeId : (out.maps[0] ? out.maps[0].id : null);
    return out;
  }

  function isValidKanbanCard(card) {
    return !!card && typeof card === 'object' &&
      typeof card.id === 'string' && typeof card.title === 'string' && typeof card.column === 'string';
  }

  /** Preenche campos ausentes de um card (compatível com projetos salvos antes do schema v2). */
  function normalizeKanbanCard(raw) {
    return {
      id: raw.id,
      title: raw.title,
      description: typeof raw.description === 'string' ? raw.description : '',
      priority: raw.priority || 'media',
      labels: Array.isArray(raw.labels) ? raw.labels.filter(function (l) { return typeof l === 'string'; }) : [],
      column: raw.column,
      createdAt: isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      color: typeof raw.color === 'string' ? raw.color : null,
      checklist: Array.isArray(raw.checklist)
        ? raw.checklist.filter(function (t) { return t && typeof t.id === 'string' && typeof t.text === 'string'; })
          .map(function (t) { return { id: t.id, text: t.text, done: !!t.done }; })
        : [],
      isMilestone: !!raw.isMilestone,
      milestoneId: typeof raw.milestoneId === 'string' ? raw.milestoneId : null,
      deletedAt: isFinite(raw.deletedAt) ? raw.deletedAt : null,
      stage: KANBAN_STAGE_IDS.indexOf(raw.stage) !== -1 ? raw.stage : 'idea',
      categoryId: typeof raw.categoryId === 'string' ? raw.categoryId : null,
      coverImageId: typeof raw.coverImageId === 'string' ? raw.coverImageId : null,
    };
  }

  /** Migra/normaliza um documento vindo de importação ou storage, tolerando campos ausentes. */
  function normalizeDocument(input) {
    var projectType = normalizeProjectType(input && input.projectType);
    var empty = createEmptyDocument(projectType);
    if (!input || typeof input !== 'object') return empty;
    var raw = input;
    var rawKanban = raw.kanban || {};

    return {
      schemaVersion: SCHEMA_VERSION,
      projectType: projectType,
      title: typeof raw.title === 'string' ? raw.title : empty.title,
      sections: Object.assign({}, empty.sections, raw.sections || {}),
      gddLayout: normalizeGddLayout(raw.gddLayout),
      template: typeof raw.template === 'string' ? raw.template : null,
      kanban: {
        cards: Array.isArray(rawKanban.cards)
          ? rawKanban.cards.filter(isValidKanbanCard).map(normalizeKanbanCard)
          : [],
        trash: Array.isArray(rawKanban.trash)
          ? rawKanban.trash.filter(isValidKanbanCard).map(normalizeKanbanCard)
          : [],
        // Documentos salvos antes desse campo existir não têm "categories" — nesse caso semeia com as
        // categorias padrão; se o array existe (mesmo vazio), respeita a escolha do usuário de ter
        // apagado todas.
        categories: Array.isArray(rawKanban.categories)
          ? rawKanban.categories.filter(isValidKanbanCategory).map(normalizeKanbanCategory)
          : DEFAULT_KANBAN_CATEGORIES.map(function (c) { return Object.assign({}, c); }),
      },
      tools: Object.assign({}, empty.tools, raw.tools || {}),
      codex: normalizeCodex(raw.codex),
      notes: normalizeNotes(raw.notes),
      mural: normalizeMural(raw.mural),
      skillTree: normalizeSkillTree(raw.skillTree),
      levels: normalizeLevels(raw.levels),
      artDirection: normalizeArtDirection(raw.artDirection),
      atlas: normalizeAtlas(raw.atlas),
    };
  }

  /** O Designer de Cartas guarda seu estado como STRING JSON solta em doc.tools.cardDesigner (ver
   *  convenção de "ferramentas soltas" no topo do arquivo) — nenhuma outra parte do app conhece seu
   *  formato interno, então quem precisa achar mídia referenciada de fora (limpeza de órfãs, backup
   *  completo) faz o próprio parse defensivo aqui, sem importar cardDesigner.js. Devolve tanto ids de
   *  imagem (campos Imagem/Moldura por linha, verso por carta, biblioteca de ícones, verso do
   *  baralho) quanto ids de fonte customizada (fontStore), já que os dois vivem no mesmo doc. */
  function collectCardDesignerMediaIds(doc) {
    var imageIds = {}, fontIds = {};
    var raw = doc && doc.tools && doc.tools.cardDesigner;
    if (typeof raw !== 'string' || !raw) return { imageIds: imageIds, fontIds: fontIds };
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { imageIds: imageIds, fontIds: fontIds }; }
    if (!parsed || typeof parsed !== 'object') return { imageIds: imageIds, fontIds: fontIds };
    var imageFieldIds = (Array.isArray(parsed.fields) ? parsed.fields : [])
      .filter(function (f) { return f && (f.type === 'image' || f.type === 'frame'); })
      .map(function (f) { return f.id; });
    (Array.isArray(parsed.rows) ? parsed.rows : []).forEach(function (r) {
      if (!r) return;
      imageFieldIds.forEach(function (fid) { if (r[fid]) imageIds[r[fid]] = true; });
      if (r.backImageId) imageIds[r.backImageId] = true;
    });
    (Array.isArray(parsed.iconLibrary) ? parsed.iconLibrary : []).forEach(function (ic) { if (ic && ic.imageId) imageIds[ic.imageId] = true; });
    if (parsed.back && parsed.back.enabled && parsed.back.imageId) imageIds[parsed.back.imageId] = true;
    (Array.isArray(parsed.customFonts) ? parsed.customFonts : []).forEach(function (cf) { if (cf && cf.fontFileId) fontIds[cf.fontFileId] = true; });
    return { imageIds: imageIds, fontIds: fontIds };
  }

  /** Varre o documento inteiro e devolve o conjunto de ids de imagem (do banco separado do
   *  imageStore) que estão de fato em uso em algum lugar — Codex (qualquer campo do tipo "Imagem"),
   *  Notas, Mural, capa de card do Kanban e o Designer de Cartas (campos Imagem/Moldura, verso por
   *  carta, biblioteca de ícones, verso do baralho). Usado pelo cartão de armazenamento na aba Saúde
   *  pra descobrir quais imagens guardadas não têm mais nenhuma referência (sobraram de uma troca ou
   *  de um item apagado) e podem ser limpas com segurança — antes de incluir o Designer de Cartas
   *  aqui, suas imagens podiam ser apagadas por engano nessa limpeza por parecerem órfãs. Devolve um
   *  objeto { id: true } em vez de um Set por compatibilidade — o resto do projeto evita depender de
   *  recursos mais novos do navegador. */
  function collectUsedImageIds(doc) {
    var used = {};
    if (!doc) return used;
    (doc.codex && doc.codex.types || []).forEach(function (type) {
      var imageFieldIds = (type.fields || []).filter(function (f) { return f.kind === 'image'; }).map(function (f) { return f.id; });
      if (!imageFieldIds.length) return;
      (doc.codex.entries || []).filter(function (e) { return e.typeId === type.id; }).forEach(function (entry) {
        imageFieldIds.forEach(function (fieldId) {
          var id = entry.fields ? entry.fields[fieldId] : null;
          if (id) used[id] = true;
        });
      });
    });
    (doc.notes || []).forEach(function (n) { if (n.imageId) used[n.imageId] = true; });
    (doc.mural && doc.mural.items || []).forEach(function (it) { if (it.imageId) used[it.imageId] = true; });
    [(doc.kanban && doc.kanban.cards), (doc.kanban && doc.kanban.trash)].forEach(function (list) {
      (list || []).forEach(function (c) { if (c.coverImageId) used[c.coverImageId] = true; });
    });
    Object.assign(used, collectCardDesignerMediaIds(doc).imageIds);
    (doc.artDirection && doc.artDirection.styles || []).forEach(function (st) { (st.imageIds || []).forEach(function (id) { used[id] = true; }); });
    (doc.levels && doc.levels.maps || []).forEach(function (m) { (m.props || []).forEach(function (pr) { if (pr.imageId) used[pr.imageId] = true; }); });
    (doc.atlas && doc.atlas.maps || []).forEach(function (m) {
      (m.stamps || []).forEach(function (st) { if (st.imageId) used[st.imageId] = true; });
      (m.tileset || []).forEach(function (t) { if (t.imageId) used[t.imageId] = true; });
    });
    return used;
  }

  /** Ids de fonte customizada (fontStore) referenciados pelo Designer de Cartas — hoje só usado pelo
   *  backup completo (storage.js), mas fica aqui junto de collectUsedImageIds por compartilhar o
   *  mesmo parse defensivo de doc.tools.cardDesigner. */
  function collectUsedFontIds(doc) {
    if (!doc) return {};
    return collectCardDesignerMediaIds(doc).fontIds;
  }

  GDC.SCHEMA_VERSION = SCHEMA_VERSION;
  GDC.DATA_REVISION = DATA_REVISION;
  GDC.PROJECT_TYPES = PROJECT_TYPES;
  GDC.DEFAULT_PROJECT_TYPE = DEFAULT_PROJECT_TYPE;
  GDC.normalizeProjectType = normalizeProjectType;
  GDC.emptySectionsFor = emptySectionsFor;
  GDC.sectionsFor = sectionsFor;
  GDC.sectionMapFor = sectionMapFor;
  GDC.groupsFor = groupsFor;
  GDC.normalizeGddLayout = normalizeGddLayout;
  GDC.cloneGddLayout = cloneGddLayout;
  GDC.NARRATIVE_GROUP_PRESET = NARRATIVE_GROUP_PRESET;
  GDC.GDD_SECTION_COLORS = GDD_SECTION_COLORS;
  GDC.GDD_CUSTOM_MIN_CHARS = GDD_CUSTOM_MIN_CHARS;
  GDC.templatesFor = templatesFor;
  GDC.EMPTY_SECTIONS = EMPTY_SECTIONS;
  GDC.EMPTY_TOOLS = EMPTY_TOOLS;
  GDC.SECTIONS = SECTIONS;
  GDC.SECTION_MAP = SECTION_MAP;
  GDC.GROUPS = GROUPS;
  GDC.GENRE_TEMPLATES = GENRE_TEMPLATES;
  GDC.BOARDGAME_EMPTY_SECTIONS = BOARDGAME_EMPTY_SECTIONS;
  GDC.BOARDGAME_SECTIONS = BOARDGAME_SECTIONS;
  GDC.BOARDGAME_SECTION_MAP = BOARDGAME_SECTION_MAP;
  GDC.BOARDGAME_GROUPS = BOARDGAME_GROUPS;
  GDC.BOARDGAME_TEMPLATES = BOARDGAME_TEMPLATES;
  GDC.MILESTONE_COLOR_PALETTE = MILESTONE_COLOR_PALETTE;
  GDC.SUGGESTED_MILESTONES = SUGGESTED_MILESTONES;
  GDC.BOARDGAME_SUGGESTED_MILESTONES = BOARDGAME_SUGGESTED_MILESTONES;
  GDC.suggestedMilestonesFor = suggestedMilestonesFor;
  GDC.TRASH_RETENTION_DAYS = TRASH_RETENTION_DAYS;
  GDC.KANBAN_STAGES = KANBAN_STAGES;
  GDC.KANBAN_STAGE_IDS = KANBAN_STAGE_IDS;
  GDC.KANBAN_STAGE_MAP = KANBAN_STAGE_MAP;
  GDC.DEFAULT_KANBAN_CATEGORIES = DEFAULT_KANBAN_CATEGORIES;
  GDC.normalizeKanbanCategory = normalizeKanbanCategory;
  GDC.isValidKanbanCategory = isValidKanbanCategory;
  GDC.CODEX_FIELD_KINDS = CODEX_FIELD_KINDS;
  GDC.makeId = makeId;
  GDC.codexField = codexField;
  GDC.buildSuggestedCodexTypes = buildSuggestedCodexTypes;
  GDC.buildAssetTrackerCodexType = buildAssetTrackerCodexType;
  GDC.createEmptyCodex = createEmptyCodex;
  GDC.collectUsedImageIds = collectUsedImageIds;
  GDC.collectUsedFontIds = collectUsedFontIds;
  GDC.createEmptyLevelMap = createEmptyLevelMap;
  GDC.normalizeLevelMap = normalizeLevelMap;
  GDC.normalizeLevels = normalizeLevels;
  GDC.defaultCodexFieldValue = defaultCodexFieldValue;
  GDC.normalizeCodexType = normalizeCodexType;
  GDC.parseWikiLinkNames = parseWikiLinkNames;
  GDC.buildCodexGraph = buildCodexGraph;
  GDC.codexRelationsFor = codexRelationsFor;
  GDC.createEmptyDocument = createEmptyDocument;
  GDC.createEmptyKanban = createEmptyKanban;
  GDC.normalizeDocument = normalizeDocument;
  GDC.normalizeNote = normalizeNote;
  GDC.normalizeArtDirection = normalizeArtDirection;
  GDC.normalizeAtlas = normalizeAtlas;
  GDC.normalizeAtlasMap = normalizeAtlasMap;
  GDC.createEmptyAtlas = createEmptyAtlas;
  GDC.ATLAS_LAYER_IDS = ATLAS_LAYER_IDS;
  GDC.createEmptyArtDirection = createEmptyArtDirection;
  GDC.ART_COLOR_ROLES = ART_COLOR_ROLES;
  GDC.MURAL_NOTE_DEFAULT_COLOR = MURAL_NOTE_DEFAULT_COLOR;
  GDC.MURAL_SHAPE_DEFAULT_COLOR = MURAL_SHAPE_DEFAULT_COLOR;
  GDC.MURAL_ARROW_DEFAULT_COLOR = MURAL_ARROW_DEFAULT_COLOR;
  GDC.MURAL_LINE_COLORS = MURAL_LINE_COLORS;
  GDC.MURAL_SHAPE_TYPES = MURAL_SHAPE_TYPES;
  GDC.MURAL_ANCHORS = MURAL_ANCHORS;
  GDC.MURAL_LINE_STYLES = MURAL_LINE_STYLES;
  GDC.MURAL_STROKE_TOOLS = MURAL_STROKE_TOOLS;
  GDC.MURAL_PEN_COLORS = MURAL_PEN_COLORS;
  GDC.MURAL_HIGHLIGHTER_COLORS = MURAL_HIGHLIGHTER_COLORS;
  GDC.MURAL_STROKE_DEFAULT_COLOR = MURAL_STROKE_DEFAULT_COLOR;
  GDC.createEmptyMural = createEmptyMural;
  GDC.normalizeMuralItem = normalizeMuralItem;
  GDC.sanitizeRichText = sanitizeRichText;
  GDC.SKILL_TREE_ICONS = SKILL_TREE_ICONS;
  GDC.createEmptySkillTree = createEmptySkillTree;
  GDC.normalizeSkillTree = normalizeSkillTree;
  GDC.normalizeSkillNode = normalizeSkillNode;
  GDC.normalizeSkillBranch = normalizeSkillBranch;
  GDC.isValidSkillNode = isValidSkillNode;
  GDC.isValidSkillBranch = isValidSkillBranch;
}(window));
