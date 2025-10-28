console.log("Carregado!");

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 400;
canvas.height = 600;

// Carregar sons
const sounds = {
    die: new Audio('audio/die.mp3'),
    point: new Audio('audio/point.mp3'),
    wing: new Audio('audio/wing.mp3')
};

// Opcional: reduzir latência e permitir reprodução simultânea
Object.values(sounds).forEach(sound => {
    sound.preload = 'auto';
    sound.load();
});

// Defina antes de usar
let imagesLoaded = 0;
let totalImages;

// Carregar sprites
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

// totalImages logo após a criação do objeto
totalImages = Object.keys(sprites).length;

// eventos de carregamento
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

// imagens dos sprites
sprites.birdUp.src = 'sprites/yellowbird-upflap.png';
sprites.birdMid.src = 'sprites/yellowbird-midflap.png';
sprites.birdDown.src = 'sprites/yellowbird-downflap.png';
sprites.backgroundDay.src = 'sprites/background-day.png';
sprites.base.src = 'sprites/base.png';
sprites.pipeGreen.src = 'sprites/pipe-green.png';
sprites.message.src = 'sprites/message.png';
sprites.gameover.src = 'sprites/gameover.png';

// Configurações da jogabilidade
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

function drawBird() {
    const birdSprites = [sprites.birdDown, sprites.birdMid, sprites.birdUp];
    const currentFrame = Math.floor(frameCount / bird.animationSpeed) % 3;

    ctx.save();
    ctx.translate(bird.x + bird.width / 2, bird.y + bird.height / 2);

    let rotation = 0;
    if (bird.velocity < -5) rotation = -Math.PI / 6;
    else if (bird.velocity > 5) rotation = Math.PI / 4;
    ctx.rotate(rotation);

    ctx.drawImage(birdSprites[currentFrame], -bird.width / 2, -bird.height / 2, bird.width, bird.height);
    ctx.restore();
}

function drawPipe(pipe) {
    ctx.save();
    ctx.translate(pipe.x + pipeWidth / 2, pipe.top / 2);
    ctx.scale(1, -1);
    ctx.drawImage(sprites.pipeGreen, -pipeWidth / 2, -pipe.top / 2, pipeWidth, pipe.top);
    ctx.restore();

    ctx.drawImage(sprites.pipeGreen, pipe.x, pipe.bottom, pipeWidth, canvas.height - pipe.bottom - base.height);
}

function drawBackground() {
    const bgWidth = 288;
    const bgHeight = 512;
    const scale = canvas.height / bgHeight;
    const scaledWidth = bgWidth * scale;

    for (let i = 0; i < Math.ceil(canvas.width / scaledWidth) + 1; i++) {
        ctx.drawImage(sprites.backgroundDay, i * scaledWidth, 0, scaledWidth, canvas.height);
    }
}

function drawBase() {
    const scale = base.height / 112;
    const scaledWidth = base.width * scale;

    ctx.drawImage(sprites.base, base.x, base.y, scaledWidth, base.height);
    ctx.drawImage(sprites.base, base.x + scaledWidth, base.y, scaledWidth, base.height);

    if (gameRunning) {
        base.x -= base.speed;
        if (base.x <= -scaledWidth) base.x = 0;
    }
}

function updateBird(delta) {
    bird.velocity += bird.gravity * delta * 60;
    bird.y += bird.velocity * delta * 60;

    if (bird.y + bird.height > base.y) {
        bird.y = base.y - bird.height;
        bird.velocity = 0;
        gameOver();
    }
    if (bird.y < 0) {
        bird.y = 0;
        bird.velocity = 0;
    }
}

function updatePipes(delta) {
    if (frameCount % 90 === 0) {
        const minTop = 80;
        const maxTop = base.y - pipeGap - 80;
        const top = Math.random() * (maxTop - minTop) + minTop;

        pipes.push({ x: canvas.width, top: top, bottom: top + pipeGap, scored: false });
    }

    pipes.forEach((pipe, index) => {
        pipe.x -= pipeSpeed * delta * 60;

        // Tocar som de ponto
        if (!pipe.scored && pipe.x + pipeWidth < bird.x) {
            score++;
            document.getElementById('score').textContent = score;
            pipe.scored = true;
            sounds.point.currentTime = 0;
            sounds.point.play().catch(e => console.log("Erro ao tocar som:", e));
        }

        if (pipe.x + pipeWidth < 0) pipes.splice(index, 1);

        if (
            bird.x + 5 < pipe.x + pipeWidth &&
            bird.x + bird.width - 5 > pipe.x &&
            (bird.y + 5 < pipe.top || bird.y + bird.height - 5 > pipe.bottom)
        ) {
            gameOver();
        }
    });
}

function gameLoop(timestamp) {
    if (!gameRunning) return;

    if (!lastTime) lastTime = timestamp;
    const delta = (timestamp - lastTime) / 1000; // tempo em segundos
    lastTime = timestamp;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    pipes.forEach(pipe => drawPipe(pipe));
    drawBase();
    drawBird();

    updateBird(delta);
    updatePipes(delta);

    frameCount++;
    requestAnimationFrame(gameLoop);
}

function jump() {
    if (gameRunning) {
        bird.velocity = bird.jump;
        // Som de pulo
        sounds.wing.currentTime = 0;
        sounds.wing.play().catch(e => console.log("Erro ao tocar som:", e));
    }
}

function startGame() {
    console.log("startGame() foi chamado!");

    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');

    // Resetar posição do bird (meio da tela, não no topo)
    bird.y = 250;
    bird.velocity = 0;
    pipes = [];
    score = 0;
    frameCount = 0;
    base.x = 0;
    lastTime = 0; // IMPORTANTE: Resetar lastTime
    document.getElementById('score').textContent = '0';

    gameRunning = true;
    requestAnimationFrame(gameLoop);
}

function restartGame() {
    startGame();
}

function gameOver() {
    if (!gameRunning) return;
    gameRunning = false;

    // Som de morte
    sounds.die.currentTime = 0;
    sounds.die.play().catch(e => console.log("Erro ao tocar som:", e));

    document.getElementById('finalScore').textContent = `Pontuação: ${score}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
}

// Controles
canvas.addEventListener('click', jump);
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        jump();
    }
});