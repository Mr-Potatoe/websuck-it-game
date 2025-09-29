// server.js
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60; // simulation ticks per second
const BROADCAST_RATE = 10; // snapshots per second

const server = http.createServer((req, res) => {
    // optional: serve static client if you put index.html at root
    res.writeHead(200);
    res.end('WebSocket game server running.');
});

const wss = new WebSocket.Server({ server });

/** Player structure:
 * {
 *   id: string,
 *   ws: WebSocket,
 *   x: number, y: number,
 *   vx: number, vy: number,
 *   input: { up, down, left, right },
 *   color: string,
 *   lastSeen: timestamp
 * }
 */
const players = new Map();

function randomColor() {
    return '#' + crypto.randomBytes(3).toString('hex');
}

function createPlayer(ws) {
    const id = crypto.randomBytes(8).toString('hex');
    return {
        id,
        ws,
        x: Math.random() * 600 + 100,
        y: Math.random() * 400 + 100,
        vx: 0,
        vy: 0,
        speed: 180, // pixels per second
        input: { up: false, down: false, left: false, right: false },
        color: randomColor(),
        lastSeen: Date.now()
    };
}

wss.on('connection', (ws, req) => {
    const player = createPlayer(ws);
    players.set(player.id, player);

    const ip = req.socket.remoteAddress.replace("::ffff:", ""); // clean IPv4
    const id = Math.random().toString(36).slice(2, 9);

    players[id] = { x: 100, y: 100, vx: 0, vy: 0, color: randomColor(), ip };

    ws.send(JSON.stringify({ type: "welcome", id, ip }));

    // when broadcasting snapshot
    const snapshot = Object.entries(players).map(([id, p]) => ({
        id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, color: p.color, ip: p.ip
    }));

    broadcast({ type: "snapshot", players: snapshot });

    console.log('Player connected', player.id);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            handleMessage(player, msg);
        } catch (err) {
            console.warn('Invalid message', err);
        }
    });

    ws.on('close', () => {
        players.delete(player.id);
        broadcast({ type: 'remove', id: player.id });
        console.log('Player disconnected', player.id);
    });

    // Immediately tell everyone about this new player (server will also broadcast full snapshots)
    broadcast({ type: 'player_join', id: player.id, x: player.x, y: player.y, color: player.color });
});

function handleMessage(player, msg) {
    player.lastSeen = Date.now();
    switch (msg.type) {
        case 'input':
            // expected: { type: 'input', input: { up, down, left, right }, seq?: number }
            player.input = {
                up: !!msg.input.up,
                down: !!msg.input.down,
                left: !!msg.input.left,
                right: !!msg.input.right
            };
            break;
        case 'ping':
            // let client measure RTT if desired
            player.ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
            break;
        default:
            // ignore
            break;
    }
}

function broadcast(obj) {
    const raw = JSON.stringify(obj);
    for (const p of players.values()) {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(raw);
        }
    }
}

// Simulation loop
let lastTime = Date.now();
setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000; // seconds
    lastTime = now;

    // Update physics for each player
    for (const p of players.values()) {
        // simple input -> velocity mapping
        let dx = 0, dy = 0;
        if (p.input.up) dy -= 1;
        if (p.input.down) dy += 1;
        if (p.input.left) dx -= 1;
        if (p.input.right) dx += 1;

        // normalize diagonal
        if (dx !== 0 && dy !== 0) {
            const inv = 1 / Math.sqrt(2);
            dx *= inv; dy *= inv;
        }

        p.vx = dx * p.speed;
        p.vy = dy * p.speed;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // simple bounds
        p.x = Math.max(20, Math.min(980, p.x));
        p.y = Math.max(20, Math.min(580, p.y));
    }

    // optionally, here is where game logic, collisions, bullets, etc. go
}, 1000 / TICK_RATE);

// Snapshot broadcaster (less often to save bandwidth)
setInterval(() => {
    // build compact snapshot
    const snapshot = {
        type: 'snapshot',
        ts: Date.now(),
        players: []
    };
    for (const p of players.values()) {
        snapshot.players.push({
            id: p.id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            vx: Math.round(p.vx),
            vy: Math.round(p.vy),
            color: p.color
        });
    }
    broadcast(snapshot);
}, 1000 / BROADCAST_RATE);

server.listen(PORT, () => console.log(`Server running on :${PORT}`));
