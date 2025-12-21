const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

// Проверка жизни сервера
app.get('/', (req, res) => res.send('Forest Server is running (Memory Mode)'));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000 // Ждать минуту перед разрывом при лагах
});

// Хранилище в памяти (вместо БД)
let players = {}; 
let matchmakingQueue = [];

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    // 1. ЛОГИН
    socket.on('login', (username) => {
        // Создаем игрока в памяти
        players[socket.id] = {
            id: socket.id,
            username: username || "Player",
            socket: socket
        };
        
        console.log(`[LOGIN] ${username} (${socket.id})`);
        
        // Мгновенно отвечаем клиенту
        socket.emit('loginSuccess', { username: players[socket.id].username });
    });

    // 2. ПОИСК
    socket.on('findMatch', () => {
        const player = players[socket.id];
        if (!player) {
            // Если игрок не залогинен, пробуем его авто-залогинить и добавить
            console.log(`[WARN] Socket ${socket.id} tried to find match without login`);
            socket.emit('loginSuccess', { username: "Guest" }); // Просим клиента перелогиниться
            return;
        }

        // Если уже в очереди - игнор
        if (matchmakingQueue.find(p => p.id === socket.id)) return;

        matchmakingQueue.push(player);
        console.log(`[QUEUE] + ${player.username}. Всего: ${matchmakingQueue.length}`);

        tryMatchmaking();
    });

    // 3. ИГРА
    socket.on('shoot', (data) => {
        socket.to(data.room).emit('enemyShoot', data);
    });

    // 4. ДИСКОННЕКТ
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] ${socket.id}`);
        // Удаляем отовсюду
        delete players[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    });
});

function tryMatchmaking() {
    if (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();

        // Проверяем, живы ли сокеты
        if (!p1.socket.connected || !p2.socket.connected) {
            if (p1.socket.connected) matchmakingQueue.unshift(p1);
            if (p2.socket.connected) matchmakingQueue.unshift(p2);
            return;
        }

        const roomName = `battle_${p1.id}_${p2.id}`;
        p1.socket.join(roomName);
        p2.socket.join(roomName);

        console.log(`[START] ${p1.username} VS ${p2.username}`);

        io.to(p1.id).emit('gameStart', { room: roomName, role: 'green', opponent: p2.username });
        io.to(p2.id).emit('gameStart', { room: roomName, role: 'red', opponent: p1.username });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
