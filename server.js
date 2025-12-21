const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Forest Server v2 Running'));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000
});

let players = {}; 
let matchmakingQueue = [];

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    socket.on('login', (username) => {
        players[socket.id] = {
            id: socket.id,
            username: username || "Player",
            socket: socket,
            heroes: null // Сюда запишем выбор героев
        };
        socket.emit('loginSuccess', { username: players[socket.id].username });
    });

    // Изменено: теперь принимаем героев при поиске
    socket.on('findMatch', (heroData) => {
        const player = players[socket.id];
        if (!player) {
            socket.emit('loginSuccess', { username: "Guest" });
            return;
        }
        
        // Запоминаем выбор героев
        player.heroes = heroData; // { p1: 'ranger', p2: 'bear' }

        if (matchmakingQueue.find(p => p.id === socket.id)) return;

        matchmakingQueue.push(player);
        console.log(`[QUEUE] + ${player.username} (Heroes: ${heroData.p1}, ${heroData.p2})`);

        tryMatchmaking();
    });

    socket.on('shoot', (data) => {
        socket.to(data.room).emit('enemyShoot', data);
    });

    socket.on('syncTurn', (data) => {
        socket.to(data.room).emit('syncData', data.units);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    });
});

function tryMatchmaking() {
    if (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();

        if (!p1.socket.connected || !p2.socket.connected) {
            if (p1.socket.connected) matchmakingQueue.unshift(p1);
            if (p2.socket.connected) matchmakingQueue.unshift(p2);
            return;
        }

        const roomName = `battle_${p1.id}_${p2.id}`;
        p1.socket.join(roomName);
        p2.socket.join(roomName);

        console.log(`[START] ${p1.username} vs ${p2.username}`);

        // Отправляем каждому игроку информацию о враге
        io.to(p1.id).emit('gameStart', { 
            room: roomName, 
            role: 'green', 
            opponent: p2.username,
            // Вражеские герои для P1 - это герои P2
            enemyHeroes: p2.heroes 
        });

        io.to(p2.id).emit('gameStart', { 
            room: roomName, 
            role: 'red', 
            opponent: p1.username,
            // Вражеские герои для P2 - это герои P1
            enemyHeroes: p1.heroes
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
