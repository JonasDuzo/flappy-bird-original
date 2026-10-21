'use strict';

/* ==========================================================================
   FLAPPY BIRD - versão otimizada para desktop

   - A dificuldade sobe com a pontuação (10 e 20 pontos) e o cenário muda
     a cada 10 pontos a partir dos 30 (veja LEVELS e SCENERIES abaixo).
   - Tudo é calculado em TEMPO REAL (px/s), então o jogo roda igual em
     60, 144 ou 240 Hz (o original contava frames).
   - O canvas é desenhado em pixels físicos da tela (com devicePixelRatio),
     sempre na proporção 2:3, ocupando o máximo possível da janela.
   - Entrada por pointerdown/keydown (sem esperar soltar o botão).
   - Sons via Web Audio API (baixa latência, sobrepõem sem cortar).
   ========================================================================== */

// ---------------------------------------------------------------------------
// Constantes (unidades lógicas: o mundo do jogo tem 400x600)
// ---------------------------------------------------------------------------
const W = 400;
const H = 600;
const BASE_W = 336;
const BASE_H = 112;
const GROUND_Y = H - BASE_H;      // 488
const BG_W = 288;
const BG_H = 512;

const BIRD_W = 34;
const BIRD_H = 24;
const BIRD_X = 80;
const BIRD_START_Y = 250;
const HIT_PAD = 5;                // folga na hitbox do pássaro (igual ao original)

const PIPE_W = 52;
const PIPE_H = 320;               // altura do sprite do cano
const PIPE_SPACING = 300;         // distância entre canos (150 frames x 2 px no original)
const PIPE_MIN_TOP = 80;

// Física em px/s. Calibrada para reproduzir exatamente o arco do original
// (60 Hz, gravidade 0.5, pulo -9): gravidade 0.5*60*60 = 1800 px/s²,
// pulo -8.75*60 = -525 px/s (o original soma a gravidade antes de mover).
const GRAVITY = 1800;
const JUMP_VELOCITY = -525;

// Dificuldade por pontuação. O nível 0 é idêntico ao jogo original.
//   speed = velocidade de canos e chão (px/s)   gap = abertura entre os canos (px)
// O vão menor vale para os canos criados depois da mudança de nível.
const LEVELS = [
    { score: 0,  speed: 120, gap: 140, msg: null },
    { score: 10, speed: 280, gap: 130, msg: 'MAIS RÁPIDO!' },
    { score: 20, speed: 400, gap: 80, msg: 'AINDA MAIS DIFÍCIL!' }
];
const SPEED_EASE = 2.5;           // quão rápido a velocidade acompanha o novo nível

// Cenários: o primeiro troca em SCENERY_START e depois a cada SCENERY_EVERY pontos.
const SCENERY_START = 30;
const SCENERY_EVERY = 10;
const SCENERY_FADE = 1.2;         // segundos de transição suave do fundo
const SCENERIES = [
    { bg: 'bgDay',   pipe: 'pipeGreen', pipeFlip: 'pipeGreenFlipped' },
    { bg: 'bgNight', pipe: 'pipeGreen', pipeFlip: 'pipeGreenFlipped' },
    { bg: 'bgDay',   pipe: 'pipeRed',   pipeFlip: 'pipeRedFlipped' },
    { bg: 'bgNight', pipe: 'pipeRed',   pipeFlip: 'pipeRedFlipped' }
];

const WING_FPS = 12;              // troca de sprite das asas por segundo
const MAX_DT = 1 / 20;            // limita saltos após travadas
const DIVE_ROT = 1.5;             // rotação (rad) do pássaro caindo morto
const RESTART_GUARD_MS = 400;     // evita reiniciar sem querer ao morrer spamando espaço

const STATE = { READY: 0, PLAYING: 1, DYING: 2, OVER: 3 };

// ---------------------------------------------------------------------------
// Elementos da página
// ---------------------------------------------------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // fundo opaco: composição mais rápida
const container = document.getElementById('gameContainer');
const scoreEl = document.getElementById('score');
const toastEl = document.getElementById('toast');
const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
const overScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');

// ---------------------------------------------------------------------------
// Áudio: Web Audio (baixa latência). Se não for possível (ex.: abrindo o
// index.html direto do disco, onde fetch() é bloqueado), usa um pool de <audio>.
// ---------------------------------------------------------------------------
const audio = (() => {
    const FILES = { wing: 'audio/wing.mp3', point: 'audio/point.mp3', die: 'audio/die.mp3' };
    const POOL_SIZE = 4;
    let actx = null;
    const buffers = {};
    const pools = {};

    function useFallback() {
        for (const [name, src] of Object.entries(FILES)) {
            const list = [];
            for (let i = 0; i < POOL_SIZE; i++) {
                const a = new Audio(src);
                a.preload = 'auto';
                list.push(a);
            }
            pools[name] = { list, next: 0 };
        }
    }

    async function loadBuffers() {
        await Promise.all(Object.entries(FILES).map(async ([name, src]) => {
            const res = await fetch(src);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            buffers[name] = await actx.decodeAudioData(await res.arrayBuffer());
        }));
    }

    function init() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { useFallback(); return; }
        try {
            actx = new AC({ latencyHint: 'interactive' });
        } catch (e) {
            useFallback();
            return;
        }
        loadBuffers().catch(() => {
            actx.close().catch(() => { });
            actx = null;
            useFallback();
        });
    }

    function play(name) {
        if (actx && buffers[name]) {
            if (actx.state === 'suspended') actx.resume(); // política de autoplay: 1º gesto libera
            const src = actx.createBufferSource();
            src.buffer = buffers[name];
            src.connect(actx.destination);
            src.start(0);
            return;
        }
        const pool = pools[name];
        if (pool) {
            const a = pool.list[pool.next];
            pool.next = (pool.next + 1) % pool.list.length;
            a.currentTime = 0;
            const p = a.play();
            if (p) p.catch(() => { });
        }
    }

    return { init, play };
})();

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------
const sprites = {};
let wingFrames = [];

async function loadImage(src) {
    const img = new Image();
    img.src = src;
    await img.decode(); // carrega e decodifica antes do 1º frame (sem engasgos)
    return img;
}

// Cano de cima = cano normal espelhado. Espelha uma vez só, na carga.
function makeFlipped(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.translate(0, c.height);
    g.scale(1, -1);
    g.drawImage(img, 0, 0);
    return c;
}

async function loadAssets() {
    const files = {
        bgDay: 'sprites/background-day.png',
        bgNight: 'sprites/background-night.png',
        base: 'sprites/base.png',
        pipeGreen: 'sprites/pipe-green.png',
        pipeRed: 'sprites/pipe-red.png',
        birdUp: 'sprites/yellowbird-upflap.png',
        birdMid: 'sprites/yellowbird-midflap.png',
        birdDown: 'sprites/yellowbird-downflap.png'
    };
    const entries = await Promise.all(
        Object.entries(files).map(async ([key, src]) => [key, await loadImage(src)])
    );
    for (const [key, img] of entries) sprites[key] = img;
    sprites.pipeGreenFlipped = makeFlipped(sprites.pipeGreen);
    sprites.pipeRedFlipped = makeFlipped(sprites.pipeRed);
    wingFrames = [sprites.birdMid, sprites.birdUp, sprites.birdMid, sprites.birdDown];
}

// ---------------------------------------------------------------------------
// Tamanho do canvas: maior bloco 2:3 que cabe na janela, em pixels FÍSICOS
// inteiros. Assim o canvas fica nítido em qualquer monitor/zoom (1:1 com a tela).
// ---------------------------------------------------------------------------
let k = 1;                // pixels do canvas por unidade lógica
let needsResize = true;
let dirty = true;         // precisa redesenhar mesmo com o jogo parado

function applySize() {
    needsResize = false;
    const dpr = window.devicePixelRatio || 1;
    const m = Math.max(1, Math.floor(Math.min(window.innerWidth * dpr / 2, window.innerHeight * dpr / 3)));
    const bw = m * 2;
    const bh = m * 3;

    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    ctx.imageSmoothingEnabled = false; // redimensionar o canvas reseta isso

    const cssW = bw / dpr;
    container.style.width = cssW + 'px';
    container.style.height = (bh / dpr) + 'px';
    container.style.setProperty('--s', (cssW / W).toFixed(4));

    k = bw / W;
    dirty = true;
}

window.addEventListener('resize', () => { needsResize = true; });

// Detecta mudança de zoom / troca de monitor com escala diferente
function watchDpr() {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { needsResize = true; watchDpr(); }, { once: true });
}

// ---------------------------------------------------------------------------
// Estado do jogo
// ---------------------------------------------------------------------------
let state = STATE.READY;
let paused = false;
let score = 0;
let scroll = 0;           // deslocamento acumulado do chão (px lógicos)
let wingTime = 0;
let bobTime = 0;
let overAt = 0;
let level = 0;            // índice em LEVELS
let speed = LEVELS[0].speed; // velocidade atual (acompanha o nível suavemente)
let sceneryCount = 0;     // quantas trocas de cenário já aconteceram
let sceneryFrom = 0;      // cenário anterior (para a transição)
let sceneryFade = 1;      // 0..1; 1 = transição concluída
let stepDist = 0;         // distância (px) que canos e chão andam neste passo
const bird = { y: BIRD_START_Y, vy: 0, rot: 0 };
const pipes = [];

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function resetWorld() {
    bird.y = BIRD_START_Y;
    bird.vy = 0;
    bird.rot = 0;
    pipes.length = 0;
    score = 0;
    wingTime = 0;
    level = 0;
    speed = LEVELS[0].speed;
    sceneryCount = 0;
    sceneryFrom = 0;
    sceneryFade = 1;
    scoreEl.textContent = '0';
    toastEl.classList.remove('show');
}

// Aviso rápido na tela (reinicia a animação CSS a cada chamada)
function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
}

function levelForScore(sc) {
    let l = 0;
    for (let i = 0; i < LEVELS.length; i++) if (sc >= LEVELS[i].score) l = i;
    return l;
}

function sceneryForScore(sc) {
    return sc < SCENERY_START ? 0 : 1 + Math.floor((sc - SCENERY_START) / SCENERY_EVERY);
}

// Chamado a cada ponto: sobe de nível e/ou troca o cenário
function applyProgress() {
    let msg = null;

    const lv = levelForScore(score);
    if (lv !== level) {
        level = lv;
        msg = LEVELS[lv].msg;
    }

    const sc = sceneryForScore(score);
    if (sc !== sceneryCount) {
        sceneryFrom = sceneryCount;
        sceneryCount = sc;
        sceneryFade = 0;
        msg = 'NOVO CENÁRIO!';
    }

    if (msg) showToast(msg);
}

function flap() {
    bird.vy = JUMP_VELOCITY;
    audio.play('wing');
}

function startRun() {
    if (state === STATE.PLAYING || state === STATE.DYING) return;
    if (state === STATE.OVER) resetWorld();
    state = STATE.PLAYING;
    startScreen.classList.add('hidden');
    overScreen.classList.add('hidden');
    scoreEl.classList.remove('hidden');
    flap(); // o início já conta como a primeira batida de asa
}

// Colisão: o pássaro morre, mas continua caindo até o chão (como no clássico)
function kill() {
    if (state !== STATE.PLAYING) return;
    state = STATE.DYING;
    if (bird.vy < 0) bird.vy = 0;
    audio.play('die');
}

function finishRun() {
    state = STATE.OVER;
    dirty = true;
    overAt = performance.now();
    bird.rot = DIVE_ROT;
    finalScoreEl.textContent = `Pontuação: ${score}`;
    scoreEl.classList.add('hidden');
    toastEl.classList.remove('show');
    overScreen.classList.remove('hidden');
}

function pause() {
    if (paused || state !== STATE.PLAYING) return;
    paused = true;
    dirty = true;
    pauseScreen.classList.remove('hidden');
}

function resume() {
    if (!paused) return;
    paused = false;
    pauseScreen.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Atualização (dt em segundos)
// ---------------------------------------------------------------------------

// Integração exata para aceleração constante: o resultado não depende do dt.
// Retorna true se o pássaro encostou no chão.
function stepBird(dt) {
    bird.y += bird.vy * dt + 0.5 * GRAVITY * dt * dt;
    bird.vy += GRAVITY * dt;

    if (bird.y < 0) {            // teto
        bird.y = 0;
        bird.vy = 0;
    }
    if (bird.y + BIRD_H >= GROUND_Y) {
        bird.y = GROUND_Y - BIRD_H;
        bird.vy = 0;
        return true;
    }
    return false;
}

function updatePipes(dt) {
    // Novo cano a cada PIPE_SPACING px (espaçamento exato, independe do FPS).
    // Nasce ANTES de mover, para ter exatamente a mesma posição em qualquer FPS.
    const last = pipes[pipes.length - 1];
    if (!last || last.x <= W - PIPE_SPACING) {
        const gap = LEVELS[level].gap;
        const theme = SCENERIES[sceneryCount % SCENERIES.length];
        const maxTop = GROUND_Y - gap - 80;
        const top = PIPE_MIN_TOP + Math.random() * (maxTop - PIPE_MIN_TOP);
        pipes.push({
            x: last ? last.x + PIPE_SPACING : W,
            top: top,
            bottom: top + gap,
            scored: false,
            imgTop: sprites[theme.pipeFlip],   // cor do cano definida ao nascer
            imgBottom: sprites[theme.pipe]
        });
    }

    for (let i = 0; i < pipes.length; i++) pipes[i].x -= stepDist;

    const bl = BIRD_X + HIT_PAD;
    const br = BIRD_X + BIRD_W - HIT_PAD;
    const bt = bird.y + HIT_PAD;
    const bb = bird.y + BIRD_H - HIT_PAD;
    let hit = false;

    for (let i = pipes.length - 1; i >= 0; i--) { // de trás pra frente: splice seguro
        const p = pipes[i];

        if (p.x + PIPE_W < 0) {
            pipes.splice(i, 1);
            continue;
        }
        if (!p.scored && p.x + PIPE_W < BIRD_X) {
            p.scored = true;
            score++;
            scoreEl.textContent = score; // só toca no DOM quando a pontuação muda
            audio.play('point');
            applyProgress();
        }
        if (br > p.x && bl < p.x + PIPE_W && (bt < p.top || bb > p.bottom)) hit = true;
    }
    if (hit) kill();
}

function update(dt) {
    if (sceneryFade < 1) sceneryFade = Math.min(1, sceneryFade + dt / SCENERY_FADE);

    switch (state) {
        case STATE.READY:
            bobTime += dt;
            wingTime += dt;
            scroll += speed * dt;
            bird.y = BIRD_START_Y + Math.sin(bobTime * 5) * 6;
            break;

        case STATE.PLAYING:
            wingTime += dt;
            {
                // A velocidade se aproxima do alvo de forma exponencial; a distância
                // percorrida é a integral exata disso, então não depende do FPS.
                const target = LEVELS[level].speed;
                const e = Math.exp(-dt * SPEED_EASE);
                stepDist = target * dt + (speed - target) * (1 - e) / SPEED_EASE;
                speed = target + (speed - target) * e;
                scroll += stepDist;
            }
            if (stepBird(dt)) { kill(); finishRun(); return; }
            updatePipes(dt);
            break;

        case STATE.DYING:
            if (stepBird(dt)) { finishRun(); return; }
            break;

        default: // OVER: nada se move
            return;
    }

    // Inclinação suave conforme a velocidade vertical
    const target = state >= STATE.DYING ? DIVE_ROT : clamp(bird.vy * 0.001, -0.45, 1.2);
    bird.rot += (target - bird.rot) * (1 - Math.exp(-dt * 18));
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------
function render() {
    const bw = canvas.width;
    const bh = canvas.height;

    // Fundo, canos e chão em coordenadas de pixels físicos INTEIROS:
    // sem frestas entre blocos e sem "tremida" de pixel ao rolar.
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const bgTile = Math.ceil(BG_W * bh / BG_H);
    const scenery = SCENERIES[sceneryCount % SCENERIES.length];
    if (sceneryFade < 1) { // transição: fundo antigo por baixo, novo aparecendo por cima
        const old = sprites[SCENERIES[sceneryFrom % SCENERIES.length].bg];
        for (let x = 0; x < bw; x += bgTile) ctx.drawImage(old, x, 0, bgTile, bh);
        ctx.globalAlpha = sceneryFade;
    }
    for (let x = 0; x < bw; x += bgTile) ctx.drawImage(sprites[scenery.bg], x, 0, bgTile, bh);
    ctx.globalAlpha = 1;

    // Canos no tamanho natural do sprite (o original esticava e distorcia a borda)
    const pw = Math.round(PIPE_W * k);
    const ph = Math.round(PIPE_H * k);
    for (let i = 0; i < pipes.length; i++) {
        const p = pipes[i];
        const px = Math.round(p.x * k);
        ctx.drawImage(p.imgTop, px, Math.round(p.top * k) - ph, pw, ph);
        ctx.drawImage(p.imgBottom, px, Math.round(p.bottom * k), pw, ph);
    }

    // Chão com rolagem contínua
    const baseY = Math.round(GROUND_Y * k);
    const baseH = bh - baseY;
    const baseTile = Math.round(BASE_W * k);
    const off = Math.floor((scroll * k) % baseTile);
    for (let x = -off; x < bw; x += baseTile) ctx.drawImage(sprites.base, x, baseY, baseTile, baseH);

    // Pássaro (sem save/restore: matriz de rotação direta)
    const frame = wingFrames[Math.floor(wingTime * WING_FPS) % wingFrames.length];
    const cos = Math.cos(bird.rot) * k;
    const sin = Math.sin(bird.rot) * k;
    ctx.setTransform(cos, sin, -sin, cos, (BIRD_X + BIRD_W / 2) * k, (bird.y + BIRD_H / 2) * k);
    ctx.drawImage(frame, -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------------------------------------------------------------------------
// Loop principal: um requestAnimationFrame, passo variável com dt real
// ---------------------------------------------------------------------------
let lastTs = -1;

function frame(ts) {
    requestAnimationFrame(frame);

    if (needsResize) applySize();

    if (lastTs < 0) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = clamp(dt, 0, MAX_DT);

    if (!paused) update(dt);

    // Pausado ou em Game Over (sem transição) nada muda: não gasta GPU redesenhando
    if (dirty || (!paused && (state !== STATE.OVER || sceneryFade < 1))) {
        render();
        dirty = false;
    }
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
function handleAction() { // clique, toque ou espaço
    if (paused) { resume(); return; }
    switch (state) {
        case STATE.READY:
            startRun();
            break;
        case STATE.PLAYING:
            flap();
            break;
        case STATE.OVER:
            if (performance.now() - overAt > RESTART_GUARD_MS) startRun();
            break;
    }
}

// pointerdown dispara na hora do clique/toque (o "click" só dispara ao soltar)
container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    handleAction();
});

startBtn.addEventListener('click', startRun);
restartBtn.addEventListener('click', startRun);

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'Space':
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            if (!e.repeat) handleAction(); // segurar a tecla não spamma pulos
            break;
        case 'Enter':
        case 'NumpadEnter':
            if (paused || state !== STATE.PLAYING) {
                e.preventDefault();
                if (!e.repeat) handleAction();
            }
            break;
        case 'KeyP':
        case 'Escape':
            if (!e.repeat) { paused ? resume() : pause(); }
            break;
    }
});

// Pausa sozinho ao trocar de janela/aba (evita morrer no alt-tab)
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
audio.init();
watchDpr();

loadAssets().then(() => {
    applySize();
    startBtn.disabled = false;
    requestAnimationFrame(frame);
}).catch((err) => {
    console.error('Erro ao carregar recursos:', err);
    startScreen.querySelector('p').textContent = 'Erro ao carregar os recursos do jogo.';
});