import QtQuick
import QtQuick.Window
import HypeSettings

Window {
    id: win
    width: 900
    height: 620
    title: qsTr("HypeDE Asteroids")
    color: "#0b1020"

    property var ship
    property var rocks: []
    property var shots: []
    property var sparks: []
    property var keys: ({})
    property int score: 0
    property int best: 0
    property int lives: 3
    property int level: 0
    property bool over: false
    property real cooldown: 0

    function rock(x, y, r) {
        const a = Math.random() * Math.PI * 2, v = (1.2 + Math.random() * 1.4) * (60 / r) * 0.6 + level * 0.15
        const pts = []
        for (let i = 0; i < 11; i++) pts.push(0.75 + Math.random() * 0.35)
        return { x: x, y: y, r: r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: 0, spin: (Math.random() - 0.5) * 0.04, pts: pts }
    }
    function nextLevel() {
        level++
        const list = []
        for (let i = 0; i < 3 + level; i++) {
            const edge = Math.random() < 0.5
            list.push(rock(edge ? 0 : Math.random() * width, edge ? Math.random() * height : 0, 48))
        }
        rocks = list
    }
    function restart() {
        ship = { x: width / 2, y: height / 2, a: -Math.PI / 2, vx: 0, vy: 0, safe: 120 }
        score = 0; lives = 3; level = 0; over = false; shots = []; sparks = []
        nextLevel()
        canvas.forceActiveFocus()
    }
    function burst(x, y, n, c) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3
            sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 40 + Math.random() * 20, c: c })
        }
    }
    function wrap(o) {
        o.x = (o.x + width) % width
        o.y = (o.y + height) % height
    }
    function step() {
        if (!ship) return
        if (!over) {
            if (keys[Qt.Key_Left] || keys[Qt.Key_A]) ship.a -= 0.075
            if (keys[Qt.Key_Right] || keys[Qt.Key_D]) ship.a += 0.075
            if (keys[Qt.Key_Up] || keys[Qt.Key_W]) {
                ship.vx += Math.cos(ship.a) * 0.16; ship.vy += Math.sin(ship.a) * 0.16
                if (Math.random() < 0.6)
                    sparks.push({ x: ship.x - Math.cos(ship.a) * 14, y: ship.y - Math.sin(ship.a) * 14,
                                  vx: -Math.cos(ship.a) * 2 + (Math.random() - 0.5), vy: -Math.sin(ship.a) * 2 + (Math.random() - 0.5),
                                  life: 18, c: "#ffb74d" })
            }
            cooldown = Math.max(0, cooldown - 1)
            if (keys[Qt.Key_Space] && cooldown === 0) {
                shots.push({ x: ship.x + Math.cos(ship.a) * 16, y: ship.y + Math.sin(ship.a) * 16,
                             vx: Math.cos(ship.a) * 8 + ship.vx, vy: Math.sin(ship.a) * 8 + ship.vy, life: 60 })
                cooldown = 9
            }
            ship.vx *= 0.99; ship.vy *= 0.99
            ship.x += ship.vx; ship.y += ship.vy; wrap(ship)
            ship.safe = Math.max(0, ship.safe - 1)
        }
        for (const s of shots) { s.x += s.vx; s.y += s.vy; s.life--; wrap(s) }
        for (const r of rocks) { r.x += r.vx; r.y += r.vy; r.rot += r.spin; wrap(r) }
        for (const p of sparks) { p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96; p.life-- }
        const born = []
        for (const s of shots) {
            for (const r of rocks) {
                if (!r.dead && s.life > 0 && Math.hypot(s.x - r.x, s.y - r.y) < r.r) {
                    r.dead = true; s.life = 0
                    score += Math.round(100 * 48 / r.r)
                    burst(r.x, r.y, 14, "#8ab4f8")
                    if (r.r > 18) { born.push(rock(r.x, r.y, r.r / 2)); born.push(rock(r.x, r.y, r.r / 2)) }
                }
            }
        }
        if (!over && ship.safe === 0) {
            for (const r of rocks) {
                if (!r.dead && Math.hypot(ship.x - r.x, ship.y - r.y) < r.r + 10) {
                    burst(ship.x, ship.y, 40, "#ff8a80")
                    lives--
                    if (lives <= 0) { over = true; best = Math.max(best, score) }
                    else ship = { x: width / 2, y: height / 2, a: -Math.PI / 2, vx: 0, vy: 0, safe: 150 }
                    break
                }
            }
        }
        rocks = rocks.filter(r => !r.dead).concat(born)
        shots = shots.filter(s => s.life > 0)
        sparks = sparks.filter(p => p.life > 0)
        if (rocks.length === 0 && !over) nextLevel()
        canvas.requestPaint()
    }

    Timer { interval: 16; running: win.visible; repeat: true; onTriggered: win.step() }

    Canvas {
        id: canvas
        anchors.fill: parent
        focus: true
        Keys.onPressed: e => { win.keys[e.key] = true; if (e.key === Qt.Key_Return && win.over) win.restart(); if (e.key === Qt.Key_Escape) win.close(); e.accepted = true }
        Keys.onReleased: e => { win.keys[e.key] = false; e.accepted = true }
        property var stars: Array.from({ length: 90 }, () => [Math.random(), Math.random(), Math.random()])
        onPaint: {
            const c = getContext("2d")
            c.fillStyle = "#0b1020"; c.fillRect(0, 0, width, height)
            for (const s of stars) { c.fillStyle = Qt.rgba(1, 1, 1, 0.2 + s[2] * 0.5); c.fillRect(s[0] * width, s[1] * height, 1.5, 1.5) }
            c.lineWidth = 2
            for (const r of win.rocks) {
                c.strokeStyle = "#8ab4f8"; c.fillStyle = "rgba(138,180,248,0.08)"; c.beginPath()
                r.pts.forEach((k, i) => {
                    const a = r.rot + i / r.pts.length * Math.PI * 2
                    const x = r.x + Math.cos(a) * r.r * k, y = r.y + Math.sin(a) * r.r * k
                    i ? c.lineTo(x, y) : c.moveTo(x, y)
                })
                c.closePath(); c.fill(); c.stroke()
            }
            c.fillStyle = "#ffffff"
            for (const s of win.shots) { c.beginPath(); c.arc(s.x, s.y, 2.5, 0, Math.PI * 2); c.fill() }
            for (const p of win.sparks) { c.globalAlpha = Math.min(1, p.life / 30); c.fillStyle = p.c; c.fillRect(p.x, p.y, 2.5, 2.5) }
            c.globalAlpha = 1
            const s = win.ship
            if (s && !win.over && (s.safe === 0 || Math.floor(s.safe / 6) % 2 === 0)) {
                c.save(); c.translate(s.x, s.y); c.rotate(s.a)
                c.strokeStyle = "#ffffff"; c.fillStyle = "#1a73e8"; c.beginPath()
                c.moveTo(16, 0); c.lineTo(-11, 10); c.lineTo(-6, 0); c.lineTo(-11, -10); c.closePath(); c.fill(); c.stroke()
                c.restore()
            }
            c.fillStyle = "#e3e3e3"; c.font = "500 18px Roboto, sans-serif"
            c.fillText(qsTr("Score: %1").arg(win.score), 20, 32)
            c.fillText("♥ ".repeat(Math.max(0, win.lives)), width - 90, 32)
            if (win.over) {
                c.textAlign = "center"; c.font = "500 36px Roboto, sans-serif"
                c.fillText(qsTr("Game over"), width / 2, height / 2 - 10)
                c.font = "16px Roboto, sans-serif"
                c.fillText(qsTr("Best: %1 · Enter — play again").arg(win.best), width / 2, height / 2 + 24)
                c.textAlign = "start"
            }
            c.fillStyle = "rgba(227,227,227,0.5)"; c.font = "13px Roboto, sans-serif"
            c.fillText(qsTr("← → turn · ↑ thrust · Space fire · Esc quit"), 20, height - 16)
        }
    }
}
