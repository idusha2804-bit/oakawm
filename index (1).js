import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE = 'atmosphere_fx';

const SOUND_LIST = [
    ['fog', 'Туман: атмосферный амбиент'],
    ['snow', 'Снег: метель'],
    ['rain', 'Дождь'],
    ['fireflies', 'Светлячки: ночь и мерцание'],
    ['wind', 'Ветер в поле'],
    ['forest', 'Лес и птицы'],
    ['night', 'Ночь, сверчки и сова'],
    ['sea', 'Море и волны'],
    ['stream', 'Ручей'],
    ['fire', 'Костёр'],
    ['cave', 'Пещера и капли'],
    ['tavern', 'Таверна: голоса и кружки'],
    ['crowd', 'Толпа на площади'],
];
const EFFECT_IDS = ['fog', 'snow', 'rain', 'fireflies'];

const DEFAULTS = {
    enabled: true,
    master: 70,
    fog: { on: false, density: 55, size: 55, speed: 25, dir: 20, moving: true, ground: false, height: 45, color: '#cfd8e3' },
    snow: { on: false, count: 50, size: 50, speed: 40, wind: 25 },
    rain: { on: false, density: 55, speed: 60, wind: 20, splash: true, lightning: false },
    fireflies: { on: false, count: 35, size: 50, speed: 40, color: '#c8ff5a' },
    bw: { on: false, amount: 100, sway: true, swayAmp: 4, vignette: true, intensity: 40 },
    sounds: Object.fromEntries(SOUND_LIST.map(([id]) => [id, { on: false, vol: 50 }])),
};

// ---------- утилиты ----------
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = a => a[(Math.random() * a.length) | 0];
const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };

function merge(dst, src) {
    for (const k in src) {
        if (src[k] && typeof src[k] === 'object') {
            if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
            merge(dst[k], src[k]);
        } else if (dst[k] === undefined) dst[k] = src[k];
    }
    return dst;
}
function cfg() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = {};
    return merge(extension_settings[MODULE], DEFAULTS);
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
function setPath(o, p, v) {
    const ks = p.split('.'); const last = ks.pop();
    ks.reduce((a, k) => a[k], o)[last] = v;
}

// =====================================================================
//                              ВИЗУАЛ
// =====================================================================
let fogC, fogX, pC, pX, bolt, W = 0, H = 0, raf = 0, last = 0, T = 0;
const lvl = { fog: 0, snow: 0, rain: 0, fireflies: 0 }; // плавное появление/исчезновение
const fog = { puffs: [], sprites: [], color: '' };
const snow = { flakes: [], sprite: null };
const rain = { drops: [], ripples: [], next: 5 };
const ff = { list: [], sprite: null, color: '' };
const LAYER = [0.6, 1, 1.5];

function buildLayers() {
    const mk = (tag, id) => { const e = document.createElement(tag); e.id = id; document.body.appendChild(e); return e; };
    fogC = mk('canvas', 'atm-fog');
    pC = mk('canvas', 'atm-particles');
    bolt = mk('div', 'atm-bolt');
    mk('div', 'atm-bw'); mk('div', 'atm-edge'); mk('div', 'atm-vig');
    fogX = fogC.getContext('2d');
    pX = pC.getContext('2d');
    resize();
    window.addEventListener('resize', () => { resize(); tuneAll(); });
}

function resize() {
    W = window.innerWidth; H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    pC.width = Math.round(W * dpr); pC.height = Math.round(H * dpr);
    pX.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fs = 0.5; // туман мягкий, рисуем в половину разрешения
    fogC.width = Math.round(W * fs); fogC.height = Math.round(H * fs);
    fogX.setTransform(fs, 0, 0, fs, 0, 0);
}

const areaK = () => clamp((W * H) / 300000, 0.6, 1.6);

// ----- туман -----
function makeFogSprites() {
    const col = cfg().fog.color; const [r, g, b] = hexRgb(col);
    fog.color = col; fog.sprites = [];
    for (let k = 0; k < 4; k++) {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const x = c.getContext('2d');
        for (let j = 0; j < 9; j++) {
            const cx = rand(70, 186), cy = rand(70, 186), rr = rand(40, 100);
            const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
            gr.addColorStop(0, `rgba(${r},${g},${b},0.34)`);
            gr.addColorStop(0.45, `rgba(${r},${g},${b},0.16)`);
            gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
            x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
        }
        x.globalCompositeOperation = 'destination-in';
        const m = x.createRadialGradient(128, 128, 0, 128, 128, 128);
        m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.7, 'rgba(0,0,0,0.9)'); m.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = m; x.fillRect(0, 0, 256, 256);
        fog.sprites.push(c);
    }
}
function fogTune() {
    const f = cfg().fog;
    if (f.color !== fog.color || !fog.sprites.length) makeFogSprites();
    const want = Math.round(lerp(8, 34, f.density / 100));
    while (fog.puffs.length < want) {
        fog.puffs.push({
            s: (Math.random() * 4) | 0, nx: rand(-0.3, 1.3), ny: Math.random(), rs: rand(0.6, 1.4), a: rand(0.6, 1),
            dx: rand(-1, 1), ph: rand(0, 6.28), ph2: rand(0, 6.28), rot: rand(0, 6.28), rv: rand(-0.03, 0.03),
            layer: (Math.random() * 3) | 0,
        });
    }
    fog.puffs.length = want;
}
function drawFog(dt) {
    const f = cfg().fog;
    fogX.clearRect(0, 0, W, H);
    const L = lvl.fog; if (L < 0.002) return;
    const sp = f.speed / 100, d = f.density / 100, dirv = f.dir / 100;
    const base = Math.max(W, H) * lerp(0.3, 1.0, f.size / 100);
    for (const p of fog.puffs) {
        const lm = LAYER[p.layer];
        if (f.moving) {
            p.nx += (dirv * 0.05 * sp * lm + p.dx * 0.012 * sp) * dt;
            if (p.nx > 1.3) p.nx -= 1.6; else if (p.nx < -0.3) p.nx += 1.6;
        }
        const r = base * p.rs * 0.5;
        let x = p.nx * W, y;
        if (f.ground) y = H * 1.02 - Math.pow(p.ny, 1.4) * H * (f.height / 100);
        else y = p.ny * H;
        x += Math.sin(T * 0.07 * (1 + p.dx * 0.3) + p.ph) * W * 0.03;
        y += Math.cos(T * 0.06 + p.ph2) * H * 0.025;
        const e = f.moving ? clamp(Math.min(p.nx + 0.3, 1.3 - p.nx) / 0.25, 0, 1) : 1;
        const A = (0.1 + 0.55 * d) * p.a * (0.8 + 0.2 * Math.sin(T * 0.25 + p.ph)) * e * L;
        if (A < 0.003) continue;
        fogX.save();
        fogX.translate(x, y);
        fogX.rotate(p.rot + T * p.rv);
        fogX.globalAlpha = Math.min(1, A);
        fogX.drawImage(fog.sprites[p.s], -r, -r, 2 * r, 2 * r);
        fogX.restore();
    }
    if (d > 0.6 && !f.ground) {
        const [r, g, b] = hexRgb(f.color);
        fogX.globalAlpha = ((d - 0.6) / 0.4) * 0.16 * L;
        fogX.fillStyle = `rgb(${r},${g},${b})`;
        fogX.fillRect(0, 0, W, H);
    }
    fogX.globalAlpha = 1;
}

// ----- снег -----
function makeSnowSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    snow.sprite = c;
}
function snowTune() {
    if (!snow.sprite) makeSnowSprite();
    const want = Math.round(lerp(40, 380, cfg().snow.count / 100) * areaK());
    while (snow.flakes.length < want) {
        snow.flakes.push({ x: rand(0, W), y: rand(0, H), z: 0.2 + 0.8 * Math.pow(Math.random(), 1.8), ph: rand(0, 6.28) });
    }
    snow.flakes.length = want;
}
function drawSnow(dt) {
    const L = lvl.snow; if (L < 0.002) return;
    const s = cfg().snow;
    const sz = s.size / 50, sp = s.speed / 50, wind = s.wind / 100;
    for (const f of snow.flakes) {
        const vy = (25 + f.z * 85) * sp;
        const vx = wind * 220 * f.z + Math.sin(T * 0.8 + f.ph) * (14 + 10 * f.z);
        f.x += vx * dt; f.y += vy * dt;
        if (f.y > H + 10) { f.y = -10; f.x = rand(0, W); }
        if (f.x > W + 10) f.x = -10; else if (f.x < -10) f.x = W + 10;
        const r = (1.2 + f.z * 3.2) * sz;
        const stretch = 1 + Math.abs(wind) * f.z * 1.6;
        pX.globalAlpha = (0.35 + 0.6 * f.z) * L;
        pX.drawImage(snow.sprite, f.x - r * stretch, f.y - r, 2 * r * stretch, 2 * r);
    }
    pX.globalAlpha = 1;
}

// ----- дождь -----
function rainTune() {
    const want = Math.round(lerp(60, 620, cfg().rain.density / 100) * areaK());
    while (rain.drops.length < want) rain.drops.push({ x: rand(-150, W + 150), y: rand(0, H), z: Math.random(), vx: 0, vy: 0 });
    rain.drops.length = want;
}
const RAIN_STYLE = [[0.6, 0.18], [0.9, 0.28], [1.3, 0.4]];
function drawRain(dt) {
    const c = cfg(), r = c.rain, L = lvl.rain;
    if (L < 0.002) return;
    const sp = r.speed / 100, wind = r.wind / 100;
    const layers = [[], [], []];
    for (const d of rain.drops) {
        const layer = d.z < 0.45 ? 0 : d.z < 0.8 ? 1 : 2;
        d.vy = (500 + d.z * 700) * (0.5 + sp);
        d.vx = wind * d.vy * 0.45;
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.y > H) {
            if (r.splash && layer > 0 && rain.ripples.length < 70 && Math.random() < 0.5) {
                rain.ripples.push({ x: d.x, y: H - Math.random() * H * 0.22, t: 0, s: layer });
            }
            d.y = -rand(0, 60); d.x = rand(-150, W + 150);
        }
        if (d.x > W + 150) d.x -= W + 300; else if (d.x < -150) d.x += W + 300;
        layers[layer].push(d);
    }
    pX.lineCap = 'round';
    for (let l = 0; l < 3; l++) {
        pX.lineWidth = RAIN_STYLE[l][0];
        pX.strokeStyle = `rgba(195,210,230,${RAIN_STYLE[l][1] * L})`;
        pX.beginPath();
        for (const d of layers[l]) {
            const k = 0.022 * (0.6 + d.z);
            pX.moveTo(d.x, d.y); pX.lineTo(d.x - d.vx * k, d.y - d.vy * k);
        }
        pX.stroke();
    }
    // круги на поверхности
    pX.lineWidth = 1;
    rain.ripples = rain.ripples.filter(rp => (rp.t += dt / 0.5) < 1);
    for (const rp of rain.ripples) {
        const rad = 3 + rp.t * 14 * rp.s;
        pX.strokeStyle = `rgba(200,215,235,${(1 - rp.t) * 0.35 * L})`;
        pX.beginPath(); pX.ellipse(rp.x, rp.y, rad, rad * 0.35, 0, 0, 6.2832); pX.stroke();
    }
    // молнии
    if (r.lightning && c.enabled) {
        rain.next -= dt;
        if (rain.next <= 0) {
            rain.next = rand(7, 20);
            bolt.classList.remove('go'); void bolt.offsetWidth; bolt.classList.add('go');
            setTimeout(thunder, rand(500, 2600));
        }
    }
}

// ----- светлячки -----
function makeFFSprite() {
    const col = cfg().fireflies.color; const [r, g, b] = hexRgb(col);
    ff.color = col;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, `rgba(${r},${g},${b},0.95)`);
    gr.addColorStop(0.35, `rgba(${r},${g},${b},0.35)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    ff.sprite = c;
}
function ffTune() {
    if (!ff.sprite || ff.color !== cfg().fireflies.color) makeFFSprite();
    const want = Math.round(lerp(6, 70, cfg().fireflies.count / 100) * areaK());
    while (ff.list.length < want) {
        ff.list.push({ x: rand(0, W), y: rand(0, H), ang: rand(0, 6.28), av: 0, ph: rand(0, 6.28), bf: rand(0.25, 0.7), z: rand(0.5, 1), sp: rand(0.6, 1.3) });
    }
    ff.list.length = want;
}
function drawFF(dt) {
    const L = lvl.fireflies; if (L < 0.002) return;
    const f = cfg().fireflies, sp = f.speed / 50, sz = f.size / 50;
    pX.globalCompositeOperation = 'lighter';
    for (const o of ff.list) {
        o.av += (Math.random() - 0.5) * 6 * dt;
        o.av = clamp(o.av - o.av * 0.8 * dt, -1.6, 1.6);
        o.ang += o.av * dt;
        const v = 22 * sp * o.sp * (0.6 + 0.4 * Math.sin(T * 0.7 + o.ph));
        o.x += Math.cos(o.ang) * v * dt;
        o.y += (Math.sin(o.ang) * 0.7 - 0.12) * v * dt;
        if (o.x > W + 20) o.x = -20; else if (o.x < -20) o.x = W + 20;
        if (o.y > H + 20) o.y = -20; else if (o.y < -20) o.y = H + 20;
        const b = Math.pow(Math.max(0, Math.sin(T * o.bf * 3 + o.ph)), 2.2);
        const r = (7 + o.z * 9) * sz * (0.8 + 0.5 * b);
        pX.globalAlpha = (0.12 + 0.88 * b) * o.z * L;
        pX.drawImage(ff.sprite, o.x - r, o.y - r, 2 * r, 2 * r);
    }
    pX.globalCompositeOperation = 'source-over';
    pX.globalAlpha = 1;
}

// ----- главный цикл -----
function targetOn(k) { const c = cfg(); return c.enabled && c[k].on; }
function needAnim() { return Object.keys(lvl).some(k => targetOn(k) || lvl[k] > 0.002); }

function frame(ts) {
    raf = 0;
    if (!needAnim()) { fogX.clearRect(0, 0, W, H); pX.clearRect(0, 0, W, H); last = 0; return; }
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts; T += dt;
    for (const k of Object.keys(lvl)) {
        const tgt = targetOn(k) ? 1 : 0;
        lvl[k] += clamp(tgt - lvl[k], -dt / 1.5, dt / 1.5);
    }
    pX.clearRect(0, 0, W, H);
    drawFog(dt); drawSnow(dt); drawRain(dt); drawFF(dt);
    raf = requestAnimationFrame(frame);
}
function kick() {
    if (needAnim() && !raf) { last = 0; raf = requestAnimationFrame(frame); }
}
function tuneAll() { fogTune(); snowTune(); rainTune(); ffTune(); }

// ----- ч/б режим, виньетка, плавание -----
function applyBW() {
    const c = cfg(), b = c.bw, on = c.enabled && b.on, t = b.intensity / 100;
    const root = document.documentElement.style;
    root.setProperty('--atm-gray', (b.amount / 100).toFixed(2));
    root.setProperty('--atm-blur', (2 + t * 22).toFixed(1) + 'px');
    root.setProperty('--atm-inner', (55 - t * 50).toFixed(0) + '%');
    root.setProperty('--atm-va', (0.25 + t * 0.65).toFixed(2));
    root.setProperty('--atm-vi', (55 - t * 40).toFixed(0) + '%');
    root.setProperty('--atm-amp', b.swayAmp);
    document.getElementById('atm-bw').classList.toggle('on', on);
    document.getElementById('atm-edge').classList.toggle('on', on && b.vignette);
    document.getElementById('atm-vig').classList.toggle('on', on && b.vignette);
    document.body.classList.toggle('atm-sway', on && b.sway);
}

// =====================================================================
//                               ЗВУК
// =====================================================================
let ctx, master, revIn;
const noiseCache = {};
const playing = {};

function getCtx() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = cfg().master / 100;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
        // общая реверберация
        revIn = ctx.createGain();
        const conv = ctx.createConvolver();
        const len = Math.floor(ctx.sampleRate * 2.8);
        const imp = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = imp.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
        }
        conv.buffer = imp;
        const revOut = ctx.createGain(); revOut.gain.value = 0.6;
        revIn.connect(conv); conv.connect(revOut); revOut.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
}
document.addEventListener('pointerdown', () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}, { passive: true });

function noiseBuf(type) {
    if (noiseCache[type]) return noiseCache[type];
    const sr = ctx.sampleRate, len = sr * 6, f = Math.floor(sr * 0.06);
    const a = new Float32Array(len + f);
    let lastv = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < a.length; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'white') a[i] = w;
        else if (type === 'brown') { lastv = (lastv + 0.02 * w) / 1.02; a[i] = lastv * 3.5; }
        else {
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
            a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
    }
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = a[i];
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = a[i] * k + a[len + i] * (1 - k); } // бесшовная петля
    noiseCache[type] = buf;
    return buf;
}

// набор инструментов для построения звука; всё, что создано через него, останавливается само
function makeKit(c, out) {
    const srcs = [], timers = [];
    const k = {
        c, out,
        noise(type = 'white') {
            const s = c.createBufferSource(); s.buffer = noiseBuf(type); s.loop = true;
            s.start(0, Math.random() * 4); srcs.push(s); return s;
        },
        osc(type, f) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); srcs.push(o); return o; },
        gain(v = 1) { const g = c.createGain(); g.gain.value = v; return g; },
        filter(type, f, q = 1) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; },
        lfo(rate, depth, target, type = 'sine') {
            const o = k.osc(type, rate); const g = c.createGain(); g.gain.value = depth;
            o.connect(g); g.connect(target); return o;
        },
        send(node, amt) { const g = c.createGain(); g.gain.value = amt; node.connect(g); g.connect(revIn); },
        every(fn, minMs, maxMs) {
            let stopped = false, id;
            const tick = () => {
                if (stopped) return;
                try { fn(); } catch (e) { /* игнор */ }
                id = setTimeout(tick, minMs + Math.random() * (maxMs - minMs));
            };
            id = setTimeout(tick, Math.random() * minMs);
            timers.push(() => { stopped = true; clearTimeout(id); });
        },
        dispose() {
            timers.forEach(t => t());
            srcs.forEach(s => { try { s.stop(); } catch (e) { /* уже остановлен */ } });
        },
    };
    return k;
}

// короткий тон с огибающей (капля, колокольчик, кружка…)
function ping(k, f, dur, vol, wet = 0.8, type = 'sine', delay = 0) {
    const c = k.c, t = c.currentTime + 0.02 + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(k.out); k.send(g, wet);
    o.start(t); o.stop(t + dur + 0.05);
}
function bell(k, f) { ping(k, f, 5, 0.07, 1.4); ping(k, f * 2.76, 2.2, 0.02, 1.4); ping(k, f * 5.4, 1, 0.008, 1.4); }

function windBed(k, o) {
    const { f = 500, depth = 300, vol = 0.5, whistle = false } = o;
    const n = k.noise('pink'), bp = k.filter('bandpass', f, 0.6), g = k.gain(vol * 0.6);
    k.lfo(0.07, depth, bp.frequency); k.lfo(0.13, depth * 0.5, bp.frequency);
    k.lfo(0.09, vol * 0.35, g.gain); k.lfo(0.21, vol * 0.15, g.gain);
    n.connect(bp); bp.connect(g); g.connect(k.out); k.send(g, 0.25);
    const r = k.noise('brown'), lp = k.filter('lowpass', 130), rg = k.gain(vol * 0.5);
    r.connect(lp); lp.connect(rg); rg.connect(k.out);
    if (whistle) {
        const w = k.noise('white'), wb = k.filter('bandpass', 900, 18), wg = k.gain(0.05);
        k.lfo(0.05, 300, wb.frequency); k.lfo(0.11, 150, wb.frequency); k.lfo(0.08, 0.04, wg.gain);
        w.connect(wb); wb.connect(wg); wg.connect(k.out); k.send(wg, 0.5);
    }
}

function crickets(k, v) {
    [4200, 4550, 3900].forEach(f => {
        const o = k.osc('sine', f + Math.random() * 60), g1 = k.gain(0.03 * v), g2 = k.gain(0.5);
        k.lfo(20 + Math.random() * 8, 0.03 * v, g1.gain, 'square');
        k.lfo(0.9 + Math.random() * 0.9, 0.5, g2.gain);
        o.connect(g1); g1.connect(g2); g2.connect(k.out);
    });
}

function birdPhrase(k) {
    const c = k.c; let t = c.currentTime + 0.02;
    const base = rand(1800, 4200), n = 2 + ((Math.random() * 5) | 0), up = Math.random() < 0.5;
    for (let i = 0; i < n; i++) {
        const d = rand(0.05, 0.13), f0 = base * (up ? 1 + i * 0.06 : 1 - i * 0.04), f1 = f0 * (up ? rand(1.15, 1.5) : rand(0.7, 0.9));
        const o = c.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(rand(0.04, 0.09), t + d * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(k.out); k.send(g, 0.3);
        o.start(t); o.stop(t + d + 0.02);
        t += d + rand(0.04, 0.1);
    }
}

const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]];
function crowd(k, o) {
    const { voices = 8, vol = 1, wet = 0.4 } = o, c = k.c;
    const bus = k.gain(1.8 * vol), lp = k.filter('lowpass', 3200, 0.5);
    bus.connect(lp); lp.connect(k.out); k.send(lp, wet);
    for (let v = 0; v < voices; v++) {
        const female = Math.random() < 0.4, f0 = female ? rand(190, 280) : rand(95, 145);
        const osc = k.osc('sawtooth', f0);
        k.lfo(rand(4.5, 6.5), f0 * 0.015, osc.frequency);
        const fa = k.filter('bandpass', 700, 6), fb = k.filter('bandpass', 1200, 8), env = k.gain(0);
        osc.connect(fa); osc.connect(fb); fa.connect(env); fb.connect(env);
        if (c.createStereoPanner) {
            const pan = c.createStereoPanner(); pan.pan.value = rand(-0.8, 0.8);
            env.connect(pan); pan.connect(bus);
        } else env.connect(bus);
        let silentUntil = 0;
        k.every(() => {
            const t = c.currentTime;
            if (t < silentUntil) return;
            if (Math.random() < 0.12) { silentUntil = t + rand(0.8, 3.3); env.gain.setTargetAtTime(0, t, 0.05); return; }
            const vw = pick(VOWELS), sh = female ? 1.15 : 1;
            fa.frequency.setTargetAtTime(vw[0] * sh, t, 0.03);
            fb.frequency.setTargetAtTime(vw[1] * sh, t, 0.03);
            osc.frequency.setTargetAtTime(f0 * rand(0.9, 1.2), t, 0.04);
            env.gain.cancelScheduledValues(t);
            env.gain.setTargetAtTime(rand(0.25, 0.5), t, 0.02);
            env.gain.setTargetAtTime(0, t + 0.09, 0.04);
        }, 170, 380);
    }
}

function firePop(k) {
    const c = k.c, t = c.currentTime + 0.01;
    const s = c.createBufferSource(); s.buffer = noiseBuf('white');
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1500, 6000); bp.Q.value = 2;
    const g = c.createGain(); const v = Math.random() < 0.15 ? rand(0.25, 0.5) : rand(0.04, 0.18);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.015, 0.05));
    s.connect(bp); bp.connect(g); g.connect(k.out);
    s.start(t, Math.random() * 4, 0.08);
}

const SOUNDS = {
    fog(k) {
        const pad = k.gain(1), lp = k.filter('lowpass', 520, 0.6);
        [55, 82.41, 110, 164.81, 220.5].forEach((f, i) => {
            const o = k.osc(i % 2 ? 'triangle' : 'sine', f * (1 + (Math.random() - 0.5) * 0.006));
            const base = 0.15 / (1 + i * 0.25), g = k.gain(base);
            o.connect(g); g.connect(pad);
            k.lfo(0.03 + Math.random() * 0.05, base * 0.6, g.gain);
        });
        k.lfo(0.04, 260, lp.frequency);
        pad.connect(lp); lp.connect(k.out); k.send(lp, 0.9);
        const n = k.noise('pink'), bp = k.filter('bandpass', 650, 0.4), ng = k.gain(0.12);
        k.lfo(0.06, 300, bp.frequency);
        n.connect(bp); bp.connect(ng); ng.connect(k.out); k.send(ng, 0.4);
        k.every(() => bell(k, pick([220, 246.94, 293.66, 329.63]) * (Math.random() < 0.3 ? 2 : 1)), 9000, 24000);
    },
    snow(k) { windBed(k, { f: 520, depth: 380, vol: 0.9, whistle: true }); },
    rain(k) {
        const n = k.noise('white'), hp = k.filter('highpass', 1200, 0.5), lp = k.filter('lowpass', 9000, 0.3), g = k.gain(0.22);
        n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(k.out);
        k.lfo(0.1, 0.05, g.gain);
        const n2 = k.noise('pink'), bp = k.filter('bandpass', 3200, 0.5), g2 = k.gain(0.25);
        n2.connect(bp); bp.connect(g2); g2.connect(k.out);
        const r = k.noise('brown'), rl = k.filter('lowpass', 250), rg = k.gain(0.5);
        r.connect(rl); rl.connect(rg); rg.connect(k.out);
        k.every(() => ping(k, rand(900, 2700), 0.08, rand(0.05, 0.1), 0.5), 120, 600);
    },
    fireflies(k) {
        crickets(k, 0.7);
        windBed(k, { f: 240, depth: 80, vol: 0.08 });
        const pad = k.gain(1);
        [392, 587.33, 783.99].forEach((f, i) => {
            const o = k.osc('sine', f * (1 + Math.random() * 0.003)), g = k.gain(0.014);
            k.lfo(0.05 + i * 0.03, 0.012, g.gain);
            o.connect(g); g.connect(pad);
        });
        pad.connect(k.out); k.send(pad, 1.4);
        const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
        k.every(() => {
            ping(k, pick(scale), 2.4, 0.05, 1.5);
            if (Math.random() < 0.4) ping(k, pick(scale), 2.4, 0.035, 1.5, 'sine', 0.35);
        }, 1800, 6500);
    },
    wind(k) { windBed(k, { f: 380, depth: 220, vol: 0.6 }); },
    forest(k) {
        windBed(k, { f: 300, depth: 120, vol: 0.25 });
        const n = k.noise('pink'), hp = k.filter('highpass', 2600, 0.5), g = k.gain(0.05);
        k.lfo(0.17, 0.035, g.gain);
        n.connect(hp); hp.connect(g); g.connect(k.out);
        k.every(() => birdPhrase(k), 900, 4200);
        k.every(() => birdPhrase(k), 1500, 6000);
    },
    night(k) {
        crickets(k, 1);
        windBed(k, { f: 260, depth: 90, vol: 0.12 });
        k.every(() => { ping(k, 420, 0.5, 0.07, 1.1); ping(k, 380, 0.7, 0.07, 1.1, 'sine', 0.65); }, 22000, 50000);
    },
    sea(k) {
        const n = k.noise('pink'), lp = k.filter('lowpass', 500, 0.7), g = k.gain(0.55);
        k.lfo(0.085, 400, lp.frequency); k.lfo(0.085, 0.4, g.gain);
        n.connect(lp); lp.connect(g); g.connect(k.out); k.send(g, 0.3);
        const n2 = k.noise('white'), hp = k.filter('highpass', 3500, 0.4), g2 = k.gain(0.1);
        k.lfo(0.085, 0.08, g2.gain);
        n2.connect(hp); hp.connect(g2); g2.connect(k.out);
        const n3 = k.noise('brown'), l3 = k.filter('lowpass', 160), g3 = k.gain(0.4);
        n3.connect(l3); l3.connect(g3); g3.connect(k.out);
    },
    stream(k) {
        const n = k.noise('pink'), bp = k.filter('bandpass', 1700, 0.7), g = k.gain(0.55);
        [3.1, 5.3, 7.9].forEach(r => k.lfo(r, 500, bp.frequency));
        n.connect(bp); bp.connect(g); g.connect(k.out);
        const n2 = k.noise('white'), hp = k.filter('highpass', 5500, 0.5), g2 = k.gain(0.05);
        n2.connect(hp); hp.connect(g2); g2.connect(k.out);
        const n3 = k.noise('brown'), lp = k.filter('lowpass', 300), g3 = k.gain(0.25);
        n3.connect(lp); lp.connect(g3); g3.connect(k.out);
        k.every(() => ping(k, rand(700, 2000), 0.07, 0.03, 0.4), 90, 420);
    },
    fire(k) {
        const n = k.noise('brown'), lp = k.filter('lowpass', 700), g = k.gain(0.55);
        k.lfo(3.3, 0.2, g.gain); k.lfo(1.1, 0.12, g.gain);
        n.connect(lp); lp.connect(g); g.connect(k.out);
        const h = k.noise('pink'), hp = k.filter('highpass', 3500), hg = k.gain(0.04);
        k.lfo(5.7, 0.03, hg.gain);
        h.connect(hp); hp.connect(hg); hg.connect(k.out);
        k.every(() => firePop(k), 60, 500);
    },
    cave(k) {
        const o = k.osc('sine', 46), g = k.gain(0.12);
        k.lfo(0.05, 0.06, g.gain);
        o.connect(g); g.connect(k.out);
        const n = k.noise('brown'), lp = k.filter('lowpass', 140), ng = k.gain(0.5);
        n.connect(lp); lp.connect(ng); ng.connect(k.out);
        const n2 = k.noise('pink'), bp = k.filter('bandpass', 420, 0.5), g2 = k.gain(0.07);
        k.lfo(0.05, 200, bp.frequency);
        n2.connect(bp); bp.connect(g2); g2.connect(k.out); k.send(g2, 1);
        k.every(() => { const f = rand(700, 1500); ping(k, f, 0.15, 0.1, 1.8); ping(k, f * 0.98, 0.12, 0.04, 1.8, 'sine', 0.28); }, 2000, 7000);
    },
    tavern(k) {
        crowd(k, { voices: 9, vol: 1, wet: 0.35 });
        const n = k.noise('brown'), lp = k.filter('lowpass', 220), g = k.gain(0.3);
        n.connect(lp); lp.connect(g); g.connect(k.out);
        k.every(() => { const f = rand(2600, 4100); ping(k, f, 0.18, 0.05, 0.5); ping(k, f * 1.5, 0.12, 0.03, 0.5); }, 3500, 11000);
    },
    crowd(k) {
        crowd(k, { voices: 16, vol: 1.2, wet: 0.55 });
        windBed(k, { f: 300, depth: 100, vol: 0.1 });
    },
};

function thunder() {
    const p = playing.rain; if (!p || !ctx) return;
    const t = ctx.currentTime + 0.05;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf('brown'); s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(70, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.6, t + 0.15);
    g.gain.setTargetAtTime(0.0001, t + 0.3, 1.2);
    const send = ctx.createGain(); send.gain.value = 0.7;
    s.connect(lp); lp.connect(g); g.connect(p.out); g.connect(send); send.connect(revIn);
    s.start(t, Math.random() * 4); s.stop(t + 7);
}

const volGain = v => Math.pow(v / 100, 1.3) * 1.5;

function startSound(id) {
    const c = getCtx(); if (!c || !SOUNDS[id]) return;
    const out = c.createGain(); out.gain.value = 0; out.connect(master);
    const kit = makeKit(c, out);
    try { SOUNDS[id](kit); } catch (e) { console.error('[Atmosphere] sound', id, e); }
    playing[id] = { out, kit };
    out.gain.setTargetAtTime(volGain(cfg().sounds[id].vol), c.currentTime, 0.6);
}
function stopSound(id) {
    const p = playing[id]; if (!p) return;
    delete playing[id];
    const t = ctx.currentTime;
    p.out.gain.cancelScheduledValues(t);
    p.out.gain.setTargetAtTime(0, t, 0.35);
    setTimeout(() => { p.kit.dispose(); try { p.out.disconnect(); } catch (e) { /* ок */ } }, 2500);
}
function syncSounds() {
    const c = cfg(), want = {};
    if (c.enabled) {
        for (const [id] of SOUND_LIST) {
            if (!c.sounds[id].on) continue;
            if (EFFECT_IDS.includes(id) && !c[id].on) continue; // звук эффекта играет только при включённом эффекте
            want[id] = c.sounds[id].vol;
        }
    }
    if (ctx && master) master.gain.setTargetAtTime(c.master / 100, ctx.currentTime, 0.1);
    for (const id of Object.keys(playing)) if (!(id in want)) stopSound(id);
    for (const id of Object.keys(want)) {
        if (!playing[id]) startSound(id);
        else playing[id].out.gain.setTargetAtTime(volGain(want[id]), ctx.currentTime, 0.1);
    }
}

// =====================================================================
//                            ИНТЕРФЕЙС
// =====================================================================
const S = (path, label, min, max, step = 1, unit = '') =>
    `<label class="atm-row">${label}: <b data-val="${path}"></b>${unit}<input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}"></label>`;
const C = (path, label) =>
    `<label class="checkbox_label"><input type="checkbox" data-path="${path}"><span>${label}</span></label>`;
const P = (path, label) =>
    `<label class="atm-row">${label} <input type="color" data-path="${path}"></label>`;
const D = (title, inner) =>
    `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>${title}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">${inner}</div></div>`;
const effectSound = id => `<div class="atm-h">Звук</div>${C(`sounds.${id}.on`, 'Включить звуковое сопровождение')}${S(`sounds.${id}.vol`, 'Громкость звука', 0, 100, 5, '%')}`;
const scapeRow = (id, label) => `<div class="atm-sound">${C(`sounds.${id}.on`, label)}${S(`sounds.${id}.vol`, 'Громкость', 0, 100, 5, '%')}</div>`;

function buildHTML() {
    const nameOf = id => SOUND_LIST.find(s => s[0] === id)[1];
    return `
    <div class="atm-root inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Atmosphere</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            ${C('enabled', 'Всё включено (главный выключатель)')}
            ${S('master', 'Общая громкость', 0, 100, 5, '%')}
            <div class="menu_button" id="atm_off">Выключить все эффекты и звуки</div>

            ${D('🌫 Туман',
                C('fog.on', 'Включить туман') +
                S('fog.density', 'Плотность', 0, 100, 1, '%') +
                S('fog.size', 'Размер клубов', 0, 100, 1, '%') +
                C('fog.moving', 'Двигается (выкл: стоит на месте и только «дышит»)') +
                S('fog.speed', 'Скорость движения', 0, 100, 1, '%') +
                S('fog.dir', 'Направление ветра (влево / вправо)', -100, 100, 5) +
                C('fog.ground', 'Только у земли (стелется низом)') +
                S('fog.height', 'Высота слоя у земли', 10, 100, 5, '%') +
                P('fog.color', 'Цвет тумана') +
                effectSound('fog'))}

            ${D('❄ Снег',
                C('snow.on', 'Включить снег') +
                S('snow.count', 'Количество', 0, 100, 1, '%') +
                S('snow.size', 'Размер снежинок', 10, 100, 1, '%') +
                S('snow.speed', 'Скорость падения', 5, 100, 1, '%') +
                S('snow.wind', 'Ветер / метель', -100, 100, 5) +
                effectSound('snow'))}

            ${D('🌧 Дождь',
                C('rain.on', 'Включить дождь') +
                S('rain.density', 'Сила ливня', 0, 100, 1, '%') +
                S('rain.speed', 'Скорость капель', 0, 100, 1, '%') +
                S('rain.wind', 'Наклон от ветра', -100, 100, 5) +
                C('rain.splash', 'Круги от капель') +
                C('rain.lightning', 'Молнии и гром') +
                effectSound('rain'))}

            ${D('✨ Светлячки',
                C('fireflies.on', 'Включить светлячков') +
                S('fireflies.count', 'Количество', 0, 100, 1, '%') +
                S('fireflies.size', 'Размер свечения', 10, 100, 1, '%') +
                S('fireflies.speed', 'Скорость полёта', 5, 100, 1, '%') +
                P('fireflies.color', 'Цвет свечения') +
                effectSound('fireflies'))}

            ${D('◐ Чёрно-белый режим',
                C('bw.on', 'Включить ч/б для всей страницы') +
                S('bw.amount', 'Сила обесцвечивания', 0, 100, 5, '%') +
                C('bw.sway', 'Плавно «плывёт» страница') +
                S('bw.swayAmp', 'Сила плавания', 0, 10, 1) +
                C('bw.vignette', 'Тёмная виньетка и блюр по краям') +
                S('bw.intensity', 'Интенсивность (от лёгкой до «почти всё в блюре»)', 0, 100, 1, '%'))}

            ${D('🔊 Саундскейп',
                '<div class="atm-h">Природа</div>' +
                ['wind', 'forest', 'night', 'sea', 'stream', 'fire', 'cave'].map(id => scapeRow(id, nameOf(id))).join('') +
                '<div class="atm-h">Люди</div>' +
                ['tavern', 'crowd'].map(id => scapeRow(id, nameOf(id))).join(''))}
        </div>
    </div>`;
}

function syncUI(root) {
    root.find('[data-path]').each(function () {
        const v = getPath(cfg(), this.dataset.path);
        if (this.type === 'checkbox') this.checked = !!v; else this.value = v;
        root.find(`[data-val="${this.dataset.path}"]`).text(v);
    });
    $('#atm_wand .atm-state').text(cfg().enabled ? 'вкл' : 'выкл');
}

function refresh() {
    tuneAll(); applyBW(); syncSounds(); kick();
    $('#atm_wand .atm-state').text(cfg().enabled ? 'вкл' : 'выкл');
}

function buildUI() {
    const root = $(buildHTML());
    $('#extensions_settings2').append(root);

    root.on('input change', '[data-path]', function (e) {
        const el = this, path = el.dataset.path;
        let v;
        if (el.type === 'checkbox') { if (e.type !== 'change') return; v = el.checked; }
        else if (el.type === 'range') { if (e.type !== 'input') return; v = Number(el.value); }
        else { if (e.type !== 'input') return; v = el.value; }
        setPath(cfg(), path, v);
        root.find(`[data-val="${path}"]`).text(v);
        saveSettingsDebounced();
        refresh();
    });

    root.find('#atm_off').on('click', () => {
        const c = cfg();
        for (const id of EFFECT_IDS) c[id].on = false;
        c.bw.on = false;
        for (const [id] of SOUND_LIST) c.sounds[id].on = false;
        saveSettingsDebounced(); syncUI(root); refresh();
    });

    $('#extensionsMenu').append(`
        <div id="atm_wand" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-cloud-moon extensionsMenuExtensionButton"></div>
            Atmosphere (<span class="atm-state"></span>)
        </div>`);
    $('#atm_wand').on('click', () => {
        const c = cfg(); c.enabled = !c.enabled;
        saveSettingsDebounced(); syncUI(root); refresh();
    });

    syncUI(root);
}

jQuery(() => {
    cfg();
    buildLayers();
    buildUI();
    refresh();
});
