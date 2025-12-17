const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

// --- НАСТРОЙКИ СЕРВЕРА ---
const app = express();
app.use(cors()); // Разрешаем CORS запросы

// Простой маршрут, чтобы Render понимал, что сервер жив
app.get('/', (req, res) => {
    res.send('ForestFight Server is running...');
});

const server = http.createServer(app);

// Настройка Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", // ВАЖНО: Разрешаем подключение с любого домена (GitHub Pages)
        methods: ["GET", "POST"]
    }
});

// --- БАЗА ДАННЫХ (SQLite) ---
const db = new sqlite3.Database('./game.db', (err) => {
    if (err) console.error("Ошибка подключения к БД:", err.message);
    else console.log('Подключено к базе данных SQLite.');
});

// Создаем таблицу игроков, если её нет
db.run(`CREATE TABLE IF NOT EXISTS players (
    username TEXT PRIMARY KEY,
    rating INTEGER DEFAULT 1000,
    wins INTEGER DEFAULT 0
)`);

// --- ПЕРЕМЕННЫЕ ИГРЫ ---
let matchmakingQueue = []; // Очередь игроков, ищущих матч

// --- ЛОГИКА СОКЕТОВ ---
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    // 1. АВТОРИЗАЦИЯ (LOGIN)
    socket.on('login', (username) => {
        const safeName = username || "Player";
        
        // Проверяем, есть ли игрок в базе
        db.get("SELECT * FROM players WHERE username = ?", [safeName], (err, row) => {
            if (err) return console.error(err);

            if (row) {
                // Игрок найден — загружаем данные
                socket.userData = row;
                socket.emit('loginSuccess', row);
            } else {
                // Игрок новый — регистрируем
                const newUser = { username: safeName, rating: 1000, wins: 0 };
                db.run("INSERT INTO players (username) VALUES (?)", [safeName], (err) => {
                    if (!err) {
                        socket.userData = newUser;
                        socket.emit('loginSuccess', newUser);
                    }
                });
            }
        });
    });

    // 2. ПОИСК МАТЧА
    socket.on('findMatch', () => {
        // Если игрок не авторизован или уже в очереди — игнорируем
        if (!socket.userData) return;
        if (matchmakingQueue.find(s => s.id === socket.id)) return;

        // Добавляем в очередь
        matchmakingQueue.push(socket);
        console.log(`Игрок ${socket.userData.username} в поиске. Всего в очереди: ${matchmakingQueue.length}`);

        // Пытаемся создать пару
        tryMatchmaking();
    });

    // 3. ОБРАБОТКА ВЫСТРЕЛА
    socket.on('shoot', (data) => {
        // data содержит: { room, unitId, vector }
        // Пересылаем данные всем в комнате, КРОМЕ отправителя
        socket.to(data.room).emit('enemyShoot', {
            unitId: data.unitId,
            vector: data.vector
        });
    });

    // 4. ОТКЛЮЧЕНИЕ
    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        // Удаляем из очереди, если он там был
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);
    });
});

// Функция создания матчей
function tryMatchmaking() {
    // Пока в очереди есть хотя бы 2 человека
    while (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();

        // Проверяем, не отвалился ли кто-то, пока ждал
        if (!p1.connected || !p2.connected) {
            if (p1.connected) matchmakingQueue.unshift(p1); // Вернуть живого в начало
            if (p2.connected) matchmakingQueue.unshift(p2);
            continue;
        }

        // Создаем комнату
        const roomName = `battle_${p1.id}_${p2.id}`;
        p1.join(roomName);
        p2.join(roomName);

        console.log(`Матч создан: ${p1.userData.username} VS ${p2.userData.username}`);

        // Отправляем сигнал старта
        // p1 будет "Зеленым" (Host), p2 будет "Красным" (Client)
        io.to(p1.id).emit('gameStart', { 
            room: roomName, 
            role: 'green', 
            opponent: p2.userData.username 
        });

        io.to(p2.id).emit('gameStart', { 
            room: roomName, 
            role: 'red', 
            opponent: p1.userData.username 
        });
    }
}

// --- ЗАПУСК СЕРВЕРА ---
// process.env.PORT — это порт, который выдаст Render. 
// 3000 — запасной вариант для локального запуска.
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});