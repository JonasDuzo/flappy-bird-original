console.log("Carregado!");

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Ajusta o tamanho do canvas e desativa a suavização para manter o estilo pixelado
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    const rect = container.getBoundingClientRect();

    // Define proporção fixa 2:3 (largura x altura)
    canvas.width = 400;
    canvas.height = 600;

    // Mantém aparência pixelada dos sprites
    ctx.imageSmoothingEnabled = false;
}

// Chama a função inicialmente e também quando a janela é redimensionada
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Carregamento de sons do jogo
const sounds = {
    die: new Audio('audio/die.mp3'),
    point: new Audio('audio/point.mp3'),
    wing: new Audio('audio/wing.mp3')
};

// Pré-carrega os sons para reduzir latência
Object.values(sounds).forEach(sound => {
    sound.preload = 'auto';
    sound.load();
});

// Carregamento de imagens (sprites)
let imagesLoaded = 0;
let totalImages;

const sprites = {
    birdUp: new Image(),
    birdMid: new Image(),
    birdDown: new Image(),
    backgroundDay: new Image(),
    backgroundNight: new Image(),
    base: new Image(),
    pipeGreen: new Image(),
    pipeRed: new Image(),
    message: new Image(),
    gameover: new Image()
};

totalImages = Object.keys(sprites).length;

// Contabiliza o carregamento de cada imagem
Object.entries(sprites).forEach(([key, img]) => {
    img.onload = () => {
        console.log(`Imagem carregada: ${key}`);
        imagesLoaded++;
        if (imagesLoaded === totalImages) {
            console.log("Todas as imagens carregadas!");
        }
    };
    img.onerror = () => {
        console.error(`Erro ao carregar imagem: ${img.src}`);
    };
});

// Caminhos das imagens
sprites.birdUp.src = 'sprites/yellowbird-upflap.png';
sprites.birdMid.src = 'sprites/yellowbird-midflap.png';
sprites.birdDown.src = 'sprites/yellowbird-downflap.png';
sprites.backgroundDay.src = 'sprites/background-day.png';
sprites.base.src = 'sprites/base.png';
sprites.pipeGreen.src = 'sprites/pipe-green.png';
sprites.message.src = 'sprites/message.png';
sprites.gameover.src = 'sprites/gameover.png';

// Configurações iniciais do jogo
let bird = {
    x: 80,
    y: 250,
    width: 34,
    height: 24,
    velocity: 0,
    gravity: 0.5,
    jump: -9,
    frame: 0,
    animationSpeed: 5
};

let base = {
    x: 0,
    y: canvas.height - 112,
    width: 336,
    height: 112,
    speed: 2
};

let pipes = [];
let score = 0;
let gameRunning = false;
let frameCount = 0;
let pipeGap = 130;
let pipeWidth = 52;
let pipeSpeed = 2;
let lastTime = 0;

// Desenha o pássaro animado e rotaciona conforme a velocidade
function drawBird() {
    const birdSprites = [sprites.birdDown, sprites.birdMid, sprites.birdUp];
    const currentFrame = Math.floor(frameCount / bird.animationSpeed) % 3;

    ctx.save();
    ctx.translate(bird.x + bird.width / 2, bird.y + bird.height / 2);

    // Inclina o pássaro dependendo da velocidade
    let rotation = 0;
    if (bird.velocity < -5) rotation = -Math.PI / 6;
    else if (bird.velocity > 5) rotation = Math.PI / 4;
    ctx.rotate(rotation);

    // Desenha o sprite atual
    ctx.drawImage(birdSprites[currentFrame], -bird.width / 2, -bird.height / 2, bird.width, bird.height);
    ctx.restore();
}

// Desenha um par de canos (superior e inferior)
function drawPipe(pipe) {
    // Cano de cima (invertido)
    ctx.save();
    ctx.translate(pipe.x + pipeWidth / 2, pipe.top / 2);
    ctx.scale(1, -1);
    ctx.drawImage(sprites.pipeGreen, -pipeWidth / 2, -pipe.top / 2, pipeWidth, pipe.top);
    ctx.restore();

    // Cano de baixo
    ctx.drawImage(sprites.pipeGreen, pipe.x, pipe.bottom, pipeWidth, canvas.height - pipe.bottom - base.height);
}

// Desenha o fundo repetido no canvas
function drawBackground() {
    const bgWidth = 288;
    const bgHeight = 512;
    const scale = canvas.height / bgHeight;
    const scaledWidth = bgWidth * scale;

    // Repete o fundo horizontalmente
    for (let i = 0; i < Math.ceil(canvas.width / scaledWidth) + 1; i++) {
        ctx.drawImage(sprites.backgroundDay, i * scaledWidth, 0, scaledWidth, canvas.height);
    }
}

// Desenha e move o chão (base)
function drawBase() {
    const scale = base.height / 112;
    const scaledWidth = base.width * scale;

    // Desenha duas bases lado a lado para criar looping
    ctx.drawImage(sprites.base, base.x, base.y, scaledWidth, base.height);
    ctx.drawImage(sprites.base, base.x + scaledWidth, base.y, scaledWidth, base.height);

    // Move a base para a esquerda durante o jogo
    if (gameRunning) {
        base.x -= base.speed;
        if (base.x <= -scaledWidth) base.x = 0;
    }
}

// Atualiza a física do pássaro (gravidade, colisões)
function updateBird(delta) {
    // Normaliza delta para 60 FPS
    const normalizedDelta = delta * 60;

    bird.velocity += bird.gravity * normalizedDelta;
    bird.y += bird.velocity * normalizedDelta;

    // Colisão com o chão
    if (bird.y + bird.height > base.y) {
        bird.y = base.y - bird.height;
        bird.velocity = 0;
        gameOver();
    }

    // Limita o topo da tela
    if (bird.y < 0) {
        bird.y = 0;
        bird.velocity = 0;
    }
}

// Gera e movimenta os canos, verifica colisões e pontuação
function updatePipes(delta) {
    const normalizedDelta = delta * 60;

    // Cria novos canos periodicamente (~a cada 150 frames)
    if (frameCount % 150 === 0) {
        const minTop = 80;
        const maxTop = base.y - pipeGap - 80;
        const top = Math.random() * (maxTop - minTop) + minTop;

        pipes.push({ x: canvas.width, top: top, bottom: top + pipeGap, scored: false });
    }

    pipes.forEach((pipe, index) => {
        // Movimento dos canos
        pipe.x -= pipeSpeed * normalizedDelta;

        // Contagem de pontos
        if (!pipe.scored && pipe.x + pipeWidth < bird.x) {
            score++;
            document.getElementById('score').textContent = score;
            pipe.scored = true;
            sounds.point.currentTime = 0;
            sounds.point.play().catch(e => console.log("Erro ao tocar som:", e));
        }

        // Remove canos fora da tela
        if (pipe.x + pipeWidth < 0) pipes.splice(index, 1);

        // Detecta colisão com o pássaro
        if (
            bird.x + 5 < pipe.x + pipeWidth &&
            bird.x + bird.width - 5 > pipe.x &&
            (bird.y + 5 < pipe.top || bird.y + bird.height - 5 > pipe.bottom)
        ) {
            gameOver();
        }
    });
}

// Loop principal do jogo (renderização + atualização)
function gameLoop(timestamp) {
    if (!gameRunning) return;

    if (!lastTime) lastTime = timestamp;
    let delta = (timestamp - lastTime) / 1000; // tempo entre frames
    lastTime = timestamp;

    // Limita delta para evitar saltos bruscos
    delta = Math.min(delta, 0.1);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Desenho das camadas do jogo
    drawBackground();
    pipes.forEach(pipe => drawPipe(pipe));
    drawBase();
    drawBird();

    // Atualiza estado dos objetos
    updateBird(delta);
    updatePipes(delta);

    frameCount++;
    requestAnimationFrame(gameLoop);
}

// Faz o pássaro pular e toca o som de batida de asa
function jump() {
    if (gameRunning) {
        bird.velocity = bird.jump;
        sounds.wing.currentTime = 0;
        sounds.wing.play().catch(e => console.log("Erro ao tocar som:", e));
    }
}

// Inicializa ou reinicia o jogo do zero
function startGame() {
    console.log("startGame() foi chamado!");

    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');

    // Reseta estado do jogo
    bird.y = 250;
    bird.velocity = 0;
    pipes = [];
    score = 0;
    frameCount = 0;
    base.x = 0;
    lastTime = 0;
    document.getElementById('score').textContent = '0';

    gameRunning = true;
    requestAnimationFrame(gameLoop);
}

// Reinicia o jogo chamando startGame()
function restartGame() {
    startGame();
}

// Finaliza o jogo e exibe a tela de Game Over
function gameOver() {
    if (!gameRunning) return;
    gameRunning = false;

    sounds.die.currentTime = 0;
    sounds.die.play().catch(e => console.log("Erro ao tocar som:", e));

    document.getElementById('finalScore').textContent = `Pontuação: ${score}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
}

// Controles do jogo (mouse, toque, teclado)
canvas.addEventListener('click', jump);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    jump();
});

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        jump();
    }
});