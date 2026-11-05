/* clippy.js — a procedural, fully animated Clippy for OBS browser sources.
   No sprites: the paperclip is an SVG wire built from point lists so every part can
   move on its own and the whole clip can morph into other shapes (magnifier, floppy,
   envelope, heart, atom...), the way the original Office Assistant did. */
(function (global) {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const N_RING = 240, N_U = 120;

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const linear = t => t;
const easeIn = t => t * t * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutBounce = t => { const n1 = 7.5625, d1 = 2.75; if (t < 1 / d1) return n1 * t * t; if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + .75; if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + .9375; return n1 * (t -= 2.625 / d1) * t + .984375; };

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// ---------------------------------------------------------------- geometry
// Body coordinates: feet at (0,0), up is negative y. Clippy is ~142 wide and ~400 tall.
function arc(cx, cy, rx, ry, a0, a1, n) {
  const o = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  return o;
}
function join() {
  const o = [];
  for (const part of arguments) for (const q of part) {
    if (o.length && Math.abs(o[o.length - 1][0] - q[0]) < 1e-6 && Math.abs(o[o.length - 1][1] - q[1]) < 1e-6) continue;
    o.push(q);
  }
  return o;
}
function resample(pts, n, closed) {
  const P = closed ? pts.concat([pts[0]]) : pts;
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L[L.length - 1] || 1;
  const out = []; let j = 0;
  for (let i = 0; i < n; i++) {
    const d = closed ? total * i / n : total * i / (n - 1);
    while (j < L.length - 2 && L[j + 1] < d) j++;
    const seg = L[j + 1] - L[j]; const t = seg > 0 ? (d - L[j]) / seg : 0;
    out.push([P[j][0] + (P[j + 1][0] - P[j][0]) * t, P[j][1] + (P[j + 1][1] - P[j][1]) * t]);
  }
  return out;
}
const retrace = pts => pts.concat(pts.slice(1, -1).reverse());      // open line -> loop that renders as the line
function rotate(pts, deg, cx, cy) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(p => [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c]);
}
function toPath(pts, closed) {
  let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
  for (let i = 1; i < pts.length; i++) d += 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
  return closed ? d + 'Z' : d;
}
function lerpPts(a, b, t) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = [a[i][0] + (b[i][0] - a[i][0]) * t, a[i][1] + (b[i][1] - a[i][1]) * t];
  return out;
}
const circlePts = (cx, cy, r, n, a0) => { const s = a0 == null ? -Math.PI / 2 : a0; return arc(cx, cy, r, r, s, s + TAU, n || 64).slice(0, -1); };
const ringOf = pts => resample(pts, N_RING, true);
const uOf = pts => resample(pts, N_U, false);

// ---------------------------------------------------------------- shapes
// Each shape: ring (closed outer wire), u (open inner wire or null), uOn (inner wire opacity), eyes {y, dx, s}
const EYES = { y: -258, dx: 53, s: 1 };
const shapes = {};
const clippyRing = ringOf(join(
  arc(0, -312, 71, 89, -Math.PI / 2, 0, 40),
  [[71, -312], [71, -66]],
  arc(0, -66, 71, 66, 0, Math.PI, 40),
  [[-71, -66], [-71, -312]],
  arc(0, -312, 71, 89, Math.PI, 3 * Math.PI / 2, 40)));
const clippyU = uOf(join([[-44, -208], [-44, -86]], arc(0, -86, 44, 44, Math.PI, 0, 40), [[44, -86], [44, -255]]));
shapes.clippy = { ring: clippyRing, u: clippyU, uOn: 1, eyes: EYES };
// inner wire's free end lifted outward: used for the "finger tap"
shapes.clippyTap = { ring: clippyRing, uOn: 1, eyes: EYES,
  u: uOf(join([[-82, -236], [-70, -214], [-55, -190], [-47, -160], [-44, -120], [-44, -86]], arc(0, -86, 44, 44, Math.PI, 0, 40), [[44, -86], [44, -255]])) };
// inner wire's free end pointing at the viewer (used for "explain")
shapes.clippyPoint = { ring: clippyRing, uOn: 1, eyes: EYES,
  u: uOf(join([[-120, -205], [-90, -200], [-60, -195], [-46, -170], [-44, -120], [-44, -86]], arc(0, -86, 44, 44, Math.PI, 0, 40), [[44, -86], [44, -255]])) };
shapes.heart = (() => {
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const t = i / 120 * TAU;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x * 10.5, -225 - y * 10.5]);
  }
  return { ring: ringOf(pts), u: null, uOn: 0, eyes: { y: -300, dx: 56, s: .9 } };
})();
shapes.star = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? 80 : 195; pts.push([r * Math.cos(a), -215 + r * Math.sin(a)]); }
  return { ring: ringOf(pts), u: null, uOn: 0, eyes: { y: -232, dx: 42, s: .85 } };
})();
shapes.magnifier = { ring: ringOf(circlePts(0, -285, 100, 80)), u: uOf([[72, -215], [178, -102]]), uOn: 1, eyes: { y: -285, dx: 44, s: 1.05 } };
shapes.floppy = (() => {
  const r = 18, x0 = -118, x1 = 118, y0 = -395, y1 = -160;
  const pts = join([[0, y0], [x1 - r, y0]], arc(x1 - r, y0 + r, r, r, -Math.PI / 2, 0, 8), [[x1, y1 - r]], arc(x1 - r, y1 - r, r, r, 0, Math.PI / 2, 8),
    [[x0 + r, y1]], arc(x0 + r, y1 - r, r, r, Math.PI / 2, Math.PI, 8), [[x0, y0 + r]], arc(x0 + r, y0 + r, r, r, Math.PI, 3 * Math.PI / 2, 8));
  return { ring: ringOf(pts), u: uOf([[-62, -395], [-62, -328], [62, -328], [62, -395]]), uOn: 1, eyes: { y: -245, dx: 50, s: .9 } };
})();
shapes.envelope = { ring: ringOf([[0, -335], [135, -335], [135, -165], [-135, -165], [-135, -335]]), u: uOf([[-135, -335], [0, -232], [135, -335]]), uOn: 1, eyes: { y: -300, dx: 48, s: .8 } };
shapes.bulb = (() => {
  const cy = -305, R = 100, a1 = Math.PI / 3, a2 = 2 * Math.PI / 3;
  const pts = join(arc(0, cy, R, R, -Math.PI / 2, a1, 50), [[R * Math.cos(a1), -150], [R * Math.cos(a2), -150]], arc(0, cy, R, R, a2, 3 * Math.PI / 2, 50));
  return { ring: ringOf(pts), u: uOf([[-32, -212], [-20, -290], [-7, -236], [7, -290], [20, -236], [32, -212]]), uOn: 1, eyes: { y: -320, dx: 42, s: .8 } };
})();
shapes.atom = { ring: ringOf(rotate(arc(0, -235, 150, 52, -Math.PI / 2, 3 * Math.PI / 2, 80).slice(0, -1), 30, 0, -235)),
  u: uOf(rotate(arc(0, -235, 150, 52, Math.PI, Math.PI + TAU * .97, 80), -30, 0, -235)), uOn: 1, eyes: { y: -235, dx: 26, s: .62 } };
shapes.pile = (() => {
  const pts = [];
  for (let i = 0; i <= 160; i++) { const t = i / 160, a = t * TAU * 3.2, r = 12 + 85 * t; pts.push([r * Math.cos(a), -22 + r * .38 * Math.sin(a)]); }
  return { ring: ringOf(retrace(pts)), u: uOf(pts.slice(0, 70).map(p => [p[0] * .55, p[1] * .55 - 8])), uOn: 1, eyes: { y: -62, dx: 40, s: .8 } };
})();
shapes.question = { ring: ringOf(retrace(join(arc(0, -310, 72, 72, Math.PI, 5 * Math.PI / 2, 60), [[0, -238], [0, -175]]))),
  u: uOf(circlePts(0, -112, 13, 24, Math.PI)), uOn: 1, eyes: { y: -312, dx: 40, s: .8 } };
shapes.check = { ring: ringOf(retrace([[-130, -215], [-35, -118], [140, -365]])), u: null, uOn: 0, eyes: { y: -330, dx: 52, s: .9 } };
shapes.note = { ring: ringOf(rotate(arc(-45, -75, 48, 31, -Math.PI / 2, 3 * Math.PI / 2, 48).slice(0, -1), -20, -45, -75)),
  u: uOf([[-2, -82], [-2, -380], [55, -335], [72, -275]]), uOn: 1, eyes: { y: -300, dx: 50, s: .85 } };
// inner wire becomes two outstretched cupped hands (the "6-7" weighing gesture)
shapes.clippyScales = { ring: clippyRing, uOn: 1, eyes: EYES,
  u: uOf([[-172, -152], [-156, -122], [-134, -112], [-112, -122], [-97, -150],      // left cupped hand, palm up, held low and wide
          [-72, -140], [0, -100], [72, -140],                                        // shallow V through the body, well below the eyes
          [97, -150], [112, -122], [134, -112], [156, -122], [172, -152]]) };        // right cupped hand

// ---------------------------------------------------------------- tween engine
class Cancelled extends Error {}
const tweens = new Set();
function tween(obj, to, ms, ease, ambient) {
  const p = new Promise((resolve, reject) => {
    const from = {};
    for (const k in to) from[k] = obj[k];
    tweens.add({ obj, from, to, ms: Math.max(1, ms), ease: ease || easeInOut, t0: performance.now(), resolve, reject, ambient: !!ambient });
  });
  p.catch(() => {});          // fire-and-forget tweens may be cancelled; awaiting callers still see the rejection
  return p;
}
const wait = (ms, ambient) => tween({}, {}, ms, linear, ambient);
function stepTweens(now) {
  for (const tw of tweens) {
    const p = clamp((now - tw.t0) / tw.ms, 0, 1), e = tw.ease(p);
    for (const k in tw.to) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
    if (p >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}
function cancelActionTweens() {
  for (const tw of tweens) if (!tw.ambient) { tweens.delete(tw); tw.reject(new Cancelled()); }
}

// ---------------------------------------------------------------- state
const base = { x: 517, y: 855, scale: 1.15 };       // rest position (stage is 1920x1080)
const P = {                                           // live pose
  x: base.x, y: base.y, scale: base.scale, dx: 0, jump: 0, rot: 0, lean: 0, squash: 1, spin: 0, opacity: 1,
  eyeOpenL: 1, eyeOpenR: 1, pupilX: 0, pupilY: 0, pupilSize: 1, eyeScale: 1,
  browLy: 0, browLr: 0, browRy: 0, browRr: 0,
  morph: 1,
};
const gazeHold = { x: 0, y: 0 };
const settings = { autoIdle: true, sound: false };
const state = { mode: 'idle', running: null, lastActivity: performance.now(), lidLock: 0, gazeLock: 0, zzz: false };
const morphState = { from: shapes.clippy, to: shapes.clippy, name: 'clippy', dirty: true };
const POS = { left: 300, centerLeft: 517, center: 960, centerRight: 1400, right: 1620 };
const groundY = x => 855 + (x - 517) * .015;

// ---------------------------------------------------------------- DOM
let svg, stage, shakeEl, root, body, ringPath, uPath, uG, face, eyeL, eyeR, browL, browR, browLg, browRg, shadow, props, particlesG, balloonEl;
const prop = {};          // top-level props (shown/hidden as a whole)
const part = {};          // pieces inside props that actions animate directly

function build(opts) {
  svg = opts.svg; stage = opts.stage; shakeEl = opts.shake || stage; balloonEl = opts.balloon;
  const defs = el('defs', null, svg);
  const metal = el('linearGradient', { id: 'cl-metal', x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
  [['0', '#eef0f3'], ['.3', '#b9bec7'], ['.62', '#7b818c'], ['1', '#4e535c']].forEach(s => el('stop', { offset: s[0], 'stop-color': s[1] }, metal));
  const eye = el('radialGradient', { id: 'cl-eye', cx: .38, cy: .34, r: .72 }, defs);
  [['0', '#ffffff'], ['.5', '#f7f8fa'], ['.82', '#d3d7de'], ['1', '#a3a8b2']].forEach(s => el('stop', { offset: s[0], 'stop-color': s[1] }, eye));
  const pup = el('radialGradient', { id: 'cl-pupil', cx: .4, cy: .38, r: .65 }, defs);
  [['0', '#3a3d44'], ['.6', '#15171b'], ['1', '#050607']].forEach(s => el('stop', { offset: s[0], 'stop-color': s[1] }, pup));
  const glow = el('radialGradient', { id: 'cl-glowgrad', cx: .5, cy: .5, r: .5 }, defs);
  [['0', 'rgba(255,240,120,.95)'], ['.5', 'rgba(255,220,60,.45)'], ['1', 'rgba(255,220,60,0)']].forEach(s => el('stop', { offset: s[0], 'stop-color': s[1] }, glow));
  const f = el('filter', { id: 'cl-shadow', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
  el('feDropShadow', { dx: 3, dy: 7, stdDeviation: 4, 'flood-color': '#000', 'flood-opacity': .32 }, f);
  const fb = el('filter', { id: 'cl-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: 7 }, fb);
  ringPath = el('path', { id: 'cl-ring' }, defs);
  uPath = el('path', { id: 'cl-u' }, defs);
  const style = el('style', null, defs);
  style.textContent = '@keyframes cl-dots{0%,100%{opacity:.2}50%{opacity:1}} .cl-dot{animation:cl-dots 1s infinite} .cl-dot:nth-child(2){animation-delay:.33s} .cl-dot:nth-child(3){animation-delay:.66s}';

  root = el('g', { id: 'clippy' }, svg);
  shadow = el('ellipse', { cx: 0, cy: 0, rx: 90, ry: 20, fill: '#1b2e0c', opacity: .35, filter: 'url(#cl-blur)' }, root);
  body = el('g', { id: 'cl-body', filter: 'url(#cl-shadow)' }, root);
  const wire = el('g', null, body);
  const layers = (href, g) => {
    const common = { href, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    el('use', Object.assign({}, common, { stroke: '#2a2e35', 'stroke-width': 26, opacity: .85 }), g);
    el('use', Object.assign({}, common, { stroke: 'url(#cl-metal)', 'stroke-width': 22 }), g);
    el('use', Object.assign({}, common, { stroke: '#ffffff', 'stroke-width': 6, opacity: .62, transform: 'translate(-3.2,-3.2)' }), g);
    el('use', Object.assign({}, common, { stroke: '#1d2026', 'stroke-width': 4.5, opacity: .35, transform: 'translate(3,4)' }), g);
  };
  layers('#cl-ring', el('g', null, wire));
  uG = el('g', null, wire); layers('#cl-u', uG);

  face = el('g', { id: 'cl-face' }, body);
  const eyeGroup = () => {
    const g = el('g', null, face);
    el('circle', { r: 42, fill: 'url(#cl-eye)', stroke: '#6b7079', 'stroke-width': 1.2 }, g);
    const p = el('g', null, g);
    el('circle', { r: 15.5, fill: 'url(#cl-pupil)' }, p);
    el('circle', { cx: -5, cy: -5.5, r: 4.3, fill: '#fff', opacity: .95 }, p);
    g._pupil = p; return g;
  };
  eyeL = eyeGroup(); eyeR = eyeGroup();
  browLg = el('g', null, face); browRg = el('g', null, face);
  browL = el('path', { d: 'M-45 -58 Q-15 -88 15 -70', stroke: '#15161a', 'stroke-width': 11, fill: 'none', 'stroke-linecap': 'round' }, browLg);
  browR = el('path', { d: 'M45 -58 Q15 -88 -15 -70', stroke: '#15161a', 'stroke-width': 11, fill: 'none', 'stroke-linecap': 'round' }, browRg);

  props = el('g', { id: 'cl-props' }, root);
  buildProps();
  particlesG = el('g', { id: 'cl-particles' }, svg);
}

function buildProps() {
  // each prop: an outer group that holds the position (SVG transform attribute, never animated)
  // and an inner group that gets the pop-in animation (CSS transform would override the attribute otherwise)
  const mk = (name, transform) => {
    const outer = el('g', transform ? { transform } : null, props);
    outer.style.display = 'none';
    const inner = el('g', null, outer);
    inner.style.transformBox = 'fill-box'; inner.style.transformOrigin = 'center';
    prop[name] = outer; outer._inner = inner;
    return inner;
  };
  // "!" above the head
  const ex = mk('exclaim');
  el('text', { x: 0, y: -512, 'font-size': 130, 'font-weight': 900, 'font-family': 'Arial Black, Impact, Arial, sans-serif', fill: '#f03b2e', stroke: '#fff', 'stroke-width': 8, 'paint-order': 'stroke', 'text-anchor': 'middle' }, ex).textContent = '!';
  // thought bubble
  const th = mk('thought');
  el('circle', { cx: 78, cy: -432, r: 8, fill: '#fff', stroke: '#444', 'stroke-width': 2 }, th);
  el('circle', { cx: 104, cy: -468, r: 13, fill: '#fff', stroke: '#444', 'stroke-width': 2 }, th);
  el('ellipse', { cx: 178, cy: -545, rx: 78, ry: 50, fill: '#fff', stroke: '#444', 'stroke-width': 2.5 }, th);
  [148, 178, 208].forEach(x => el('circle', { cx: x, cy: -545, r: 8, fill: '#333', class: 'cl-dot' }, th));
  // paper + pencil
  const wr = mk('write', 'translate(75,-30)');
  const paper = el('g', { transform: 'rotate(-8)' }, wr);
  el('rect', { x: -75, y: -190, width: 150, height: 190, fill: '#fff', stroke: '#9aa', 'stroke-width': 2, filter: 'url(#cl-shadow)' }, paper);
  for (let i = 0; i < 6; i++) el('line', { x1: -62, x2: 62, y1: -160 + i * 26, y2: -160 + i * 26, stroke: '#9fc3ea', 'stroke-width': 1.5 }, paper);
  part.scribble = el('path', { d: 'M-58 -166 q8 -9 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 M-58 -140 q8 -9 16 0 t16 0 t16 0 t16 0 t16 0 M-58 -114 q8 -9 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 M-58 -88 q8 -9 16 0 t16 0 t16 0 t16 0', stroke: '#223', 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' }, paper);
  part.pencil = el('g', null, wr);
  const pen = el('g', { transform: 'rotate(-50)' }, part.pencil);
  el('polygon', { points: '0,0 14,-7 14,7', fill: '#444' }, pen);
  el('polygon', { points: '12,-7 28,-8 28,8 12,7', fill: '#e8bb84' }, pen);
  el('rect', { x: 28, y: -8, width: 110, height: 16, fill: '#f6c431', stroke: '#b98a1a', 'stroke-width': 1.5 }, pen);
  el('rect', { x: 138, y: -8, width: 10, height: 16, fill: '#b8bcc4' }, pen);
  el('rect', { x: 148, y: -8, width: 16, height: 16, rx: 4, fill: '#f08a9a' }, pen);
  // wristwatch on the inner wire's free end
  const wa = mk('watch', 'translate(-44,-196)');
  el('rect', { x: -9, y: -28, width: 18, height: 56, rx: 4, fill: '#5b3b1c' }, wa);
  el('circle', { r: 14, fill: '#f4f4f0', stroke: '#444', 'stroke-width': 2.5 }, wa);
  el('line', { x1: 0, y1: 0, x2: 0, y2: -9, stroke: '#222', 'stroke-width': 2 }, wa);
  el('line', { x1: 0, y1: 0, x2: 6, y2: 4, stroke: '#222', 'stroke-width': 2 }, wa);
  // idea glow
  const gl = mk('glow');
  el('circle', { cx: 0, cy: -305, r: 170, fill: 'url(#cl-glowgrad)' }, gl);
}

function showProp(name, on) {
  const g = prop[name]; if (!g) return;
  g.style.display = on ? '' : 'none';
  if (on && g._inner && g._inner.animate) g._inner.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}
function hideAllProps() { for (const k in prop) if (prop[k].style) prop[k].style.display = 'none'; }

// ---------------------------------------------------------------- render
function currentShape() {
  const t = clamp(P.morph, 0, 1), a = morphState.from, b = morphState.to;
  if (t >= 1) return b;
  return { ring: lerpPts(a.ring, b.ring, t), u: lerpPts(a.u, b.u, t), uOn: lerp(a.uOn, b.uOn, t),
    eyes: { y: lerp(a.eyes.y, b.eyes.y, t), dx: lerp(a.eyes.dx, b.eyes.dx, t), s: lerp(a.eyes.s, b.eyes.s, t) } };
}
function applyShape(s) {
  ringPath.setAttribute('d', toPath(s.ring, true));
  uPath.setAttribute('d', toPath(s.u, false));
  uG.setAttribute('opacity', s.uOn);
}
let lastFrame = performance.now();
function frame(now) {
  stepTweens(now);
  stepParticles(clamp((now - lastFrame) / 1000, 0, .1)); lastFrame = now;
  const t = now / 1000;
  const idle = state.mode === 'idle' && !state.running;
  const breathe = state.mode === 'sleep' ? 1 + .03 * Math.sin(t * TAU / 4.2) : 1 + .012 * Math.sin(t * TAU / 3.3);
  const sway = idle ? 1.3 * Math.sin(t * TAU / 5.5) : 0;
  const sy = P.squash * breathe, sx = 1 + (1 - P.squash) * .6;

  root.setAttribute('transform', 'translate(' + (P.x + P.dx).toFixed(2) + ' ' + (P.y - P.jump).toFixed(2) + ')');
  root.setAttribute('opacity', P.opacity);
  body.setAttribute('transform', 'scale(' + P.scale + ') rotate(' + (P.rot + sway).toFixed(2) + ') skewX(' + P.lean.toFixed(2) + ') translate(0 -200) rotate(' + P.spin.toFixed(2) + ') translate(0 200) scale(' + sx.toFixed(4) + ' ' + sy.toFixed(4) + ')');
  props.setAttribute('transform', 'scale(' + P.scale + ')');
  const sh = clamp(1 - P.jump / 650, .25, 1);
  shadow.setAttribute('rx', 92 * P.scale * sh); shadow.setAttribute('ry', 20 * P.scale * sh);
  shadow.setAttribute('cx', 10 * P.scale); shadow.setAttribute('cy', 2);
  shadow.setAttribute('opacity', .36 * sh * P.opacity);

  const shape = currentShape();
  if (P.morph < 1 || morphState.dirty) { applyShape(shape); morphState.dirty = P.morph < 1; }
  const es = shape.eyes, s = es.s * P.eyeScale;
  const exL = -es.dx, exR = es.dx, ey = es.y;
  eyeL.setAttribute('transform', 'translate(' + exL + ' ' + ey + ') scale(' + s + ' ' + (s * Math.max(.06, P.eyeOpenL)) + ')');
  eyeR.setAttribute('transform', 'translate(' + exR + ' ' + ey + ') scale(' + s + ' ' + (s * Math.max(.06, P.eyeOpenR)) + ')');
  const pt = 'translate(' + (P.pupilX * 22).toFixed(1) + ' ' + (P.pupilY * 19).toFixed(1) + ') scale(' + P.pupilSize + ')';
  eyeL._pupil.setAttribute('transform', pt); eyeR._pupil.setAttribute('transform', pt);
  browLg.setAttribute('transform', 'translate(' + exL + ' ' + (ey + P.browLy) + ') scale(' + es.s + ') translate(-15 -74) rotate(' + P.browLr + ') translate(15 74)');
  browRg.setAttribute('transform', 'translate(' + exR + ' ' + (ey + P.browRy) + ') scale(' + es.s + ') translate(15 -74) rotate(' + P.browRr + ') translate(-15 74)');
}
// requestAnimationFrame drives the loop; a timer takes over if the page stops getting frames (hidden preview pane)
let lastTick = 0;
function loop() { const now = performance.now(); lastTick = now; frame(now); requestAnimationFrame(loop); }   // one clock everywhere
function startLoop() {
  requestAnimationFrame(loop);
  setInterval(() => { const now = performance.now(); if (now - lastTick > 120) { lastTick = now; frame(now); } }, 33);
}

// ---------------------------------------------------------------- particles
const particles = [];
function spawn(kind, n, o) {
  o = o || {};
  const hx = P.x + P.dx, hy = P.y - P.jump - 300 * P.scale;
  for (let i = 0; i < n; i++) {
    let e, p = { x: hx, y: hy, vx: 0, vy: 0, g: 0, rot: rnd(0, 360), vr: rnd(-200, 200), life: 0, ttl: 2.2, kind, s: 1 };
    if (kind === 'label') {                                   // big popping text, e.g. the "6" and "7"
      e = el('text', { 'font-size': o.size || 150, 'font-family': 'Arial Black, Impact, Arial, sans-serif', 'font-weight': 900, fill: o.color || '#ffd54a', stroke: '#1a1a1a', 'stroke-width': 8, 'paint-order': 'stroke', 'text-anchor': 'middle' }, particlesG);
      e.textContent = o.text || '!';
      p.x += (o.dx || 0) * P.scale; p.y += (o.dy || 0) * P.scale; p.vx = 0; p.vy = o.vy != null ? o.vy : -70; p.ttl = o.ttl || .9; p.vr = 0; p.rot = o.rot || 0; p.s = .1;
      p.el = e; particles.push(p); continue;
    }
    if (kind === 'confetti') {
      e = el('rect', { x: -11, y: -7, width: 22, height: 14, fill: pick(['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff9f1c']) }, particlesG);
      p.x += rnd(-60, 60); p.y += rnd(-60, 20); p.vx = rnd(-420, 420); p.vy = rnd(-820, -380); p.g = 1250; p.ttl = rnd(1.6, 2.6);
    } else if (kind === 'heart') {
      e = el('path', { d: 'M0 -6 C -8 -16 -22 -6 -12 6 L 0 16 L 12 6 C 22 -6 8 -16 0 -6 Z', fill: pick(['#ff4d6d', '#ff758f', '#e63956']) }, particlesG);
      p.x += rnd(-120, 120); p.y += rnd(-40, 60); p.vx = rnd(-40, 40); p.vy = rnd(-140, -70); p.ttl = rnd(1.8, 2.8); p.vr = rnd(-60, 60); p.s = rnd(.8, 1.6);
    } else if (kind === 'sparkle') {
      e = el('path', { d: 'M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z', fill: pick(['#fff6a8', '#ffffff', '#ffe066']) }, particlesG);
      p.x += rnd(-150, 150); p.y += rnd(-120, 160); p.vx = rnd(-30, 30); p.vy = rnd(-60, -10); p.ttl = rnd(.7, 1.3); p.s = rnd(.6, 1.4);
    } else if (kind === 'z') {
      e = el('text', { 'font-size': rnd(34, 60), 'font-family': 'Trebuchet MS, Verdana, sans-serif', 'font-weight': 700, fill: '#1e2a5a', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, particlesG);
      e.textContent = 'z'; p.x += 70 * P.scale; p.y -= 40; p.vx = 45; p.vy = -70; p.ttl = 2.6; p.vr = rnd(-20, 20); p.rot = rnd(-15, 15);
    }
    p.el = e; particles.push(p);
  }
}
function stepParticles(dt) {
  if (!particles.length) return;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life += dt;
    if (p.life >= p.ttl) { p.el.remove(); particles.splice(i, 1); continue; }
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.kind === 'confetti') p.vx *= (1 - 1.2 * dt);
    if (p.kind === 'z') p.x += Math.sin(p.life * 4) * 40 * dt;
    if (p.kind === 'label') p.s = easeOutBack(clamp(p.life / .22, 0, 1));
    const fade = p.kind === 'sparkle' ? Math.sin(Math.PI * p.life / p.ttl) : clamp((p.ttl - p.life) / (p.kind === 'label' ? .3 : .6), 0, 1);
    p.el.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ') rotate(' + p.rot.toFixed(1) + ') scale(' + p.s + ')');
    p.el.setAttribute('opacity', fade);
  }
}
function clearParticles() { for (const p of particles) p.el.remove(); particles.length = 0; }

// ---------------------------------------------------------------- sound (synthesized, optional)
const sfx = {
  ctx: null,
  ac() { try { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; } catch (e) { return null; } },
  tone(f0, f1, ms, type, vol) {
    if (!settings.sound) return; const ac = this.ac(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + ms / 1000);
    g.gain.setValueAtTime(vol || .2, t); g.gain.exponentialRampToValueAtTime(.001, t + ms / 1000);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + ms / 1000 + .05);
  },
  noise(ms, vol) {
    if (!settings.sound) return; const ac = this.ac(); if (!ac) return;
    const n = Math.floor(ac.sampleRate * ms / 1000), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = 900; g.gain.value = vol || .2;
    s.connect(f).connect(g).connect(ac.destination); s.start();
  },
  boing() { this.tone(150, 700, 280, 'sine', .22); },
  pop() { this.tone(500, 900, 90, 'triangle', .18); },
  ding() { this.tone(1320, 1300, 450, 'sine', .16); setTimeout(() => this.tone(1760, 1740, 520, 'sine', .12), 100); },
  whoosh() { this.noise(280, .15); },
  knock() { this.tone(190, 60, 90, 'square', .16); this.noise(45, .3); },
  tick() { this.tone(900, 700, 40, 'square', .08); },
};

// ---------------------------------------------------------------- balloon (HTML, classic Office Assistant look)
const balloon = {
  timer: null,
  show(text, options, ms) {
    if (!balloonEl) return;
    clearTimeout(this.timer);
    balloonEl.innerHTML = '';
    const tx = document.createElement('div'); tx.className = 'balloon-text';
    String(text || '').split(/\n/).forEach((line, i) => { if (i) tx.appendChild(document.createElement('br')); tx.appendChild(document.createTextNode(line)); });
    balloonEl.appendChild(tx);
    if (options && options.length) {
      const ul = document.createElement('ul'); ul.className = 'balloon-opts';
      options.forEach(o => { const li = document.createElement('li'); li.textContent = o; ul.appendChild(li); });
      balloonEl.appendChild(ul);
    }
    this.place();
    balloonEl.hidden = false;
    if (balloonEl.animate) balloonEl.animate([{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    if (ms > 0) this.timer = setTimeout(() => this.hide(), ms);
  },
  place() {
    const headX = P.x + P.dx, headY = P.y - P.jump - 330 * P.scale;
    const flip = headX > 1250;
    balloonEl.classList.toggle('flip', flip);
    balloonEl.style.bottom = (1080 - headY + 10) + 'px';
    balloonEl.style.left = flip ? '' : (headX + 70 * P.scale) + 'px';
    balloonEl.style.right = flip ? (1920 - headX + 70 * P.scale) + 'px' : '';
    balloonEl.style.transformOrigin = flip ? 'bottom right' : 'bottom left';
  },
  hide() { clearTimeout(this.timer); if (balloonEl) balloonEl.hidden = true; },
};

// ---------------------------------------------------------------- pose helpers
const T = (to, ms, ease) => tween(P, to, ms, ease);
function brows(ly, lr, ry, rr, ms) { tween(P, { browLy: ly, browLr: lr, browRy: ry, browRr: rr }, ms || 160, easeOut, true); }
function look(x, y, ms) { tween(P, { pupilX: x, pupilY: y }, ms || 180, easeOut, true); }
function rattle() {
  if (shakeEl && shakeEl.animate) shakeEl.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,4px)' }, { transform: 'translate(6px,-3px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' }], { duration: 170 });
}
async function hop(times, height, ms) {
  times = times || 1; height = height || 60; ms = ms || 280;
  for (let i = 0; i < times; i++) {
    await T({ squash: .8 }, ms * .3, easeOut);
    sfx.boing();
    T({ squash: 1.12 }, ms * .35, easeOut);
    await T({ jump: height }, ms * .5, easeOut);
    await T({ jump: 0 }, ms * .5, easeIn);
    await T({ squash: .86 }, ms * .2, easeOut);
    await T({ squash: 1 }, ms * .35, easeOut);
  }
}
async function morph(name, ms, ease) {
  const target = shapes[name]; if (!target) return;
  const cur = currentShape();
  const to = Object.assign({}, target);
  if (!to.u) { const c = [0, to.eyes.y + 40]; to.u = cur.u.map(() => c.slice()); }
  if (!cur.u) cur.u = to.u;
  morphState.from = cur; morphState.to = to; morphState.name = name; morphState.dirty = true;
  P.morph = 0;
  await T({ morph: 1 }, ms || 550, ease || easeInOut);
}
async function taps(n, ms) {
  for (let i = 0; i < (n || 3); i++) { sfx.tick(); await morph('clippyTap', (ms || 100) * .9, easeOut); await morph('clippy', ms || 100, easeOut); await wait(70); }
}
async function rest(ms) {
  ms = ms || 350;
  const to = { rot: 0, lean: 0, squash: 1, jump: 0, dx: 0, spin: 0, eyeScale: 1, pupilSize: 1, scale: base.scale, x: base.x, y: groundY(base.x) };
  if (state.mode !== 'sleep') Object.assign(to, { eyeOpenL: 1, eyeOpenR: 1 });
  if (state.mode === 'hidden') { to.scale = .01; } else { P.opacity = 1; }
  brows(0, 0, 0, 0, ms); look(gazeHold.x, gazeHold.y, ms);
  const jobs = [T(to, ms, easeInOut)];
  if (morphState.name !== 'clippy' || P.morph < 1) jobs.push(morph('clippy', ms + 150));
  await Promise.all(jobs);
}

// bring an interrupted body back to a neutral Clippy quickly before the next action starts
async function settle() {
  const to = { rot: 0, lean: 0, squash: 1, jump: 0, dx: 0, spin: 0, eyeScale: 1, pupilSize: 1, scale: base.scale };
  if (state.mode === 'hidden') return;
  const off = Object.keys(to).some(k => Math.abs(P[k] - to[k]) > 1e-3);
  const shaped = morphState.name !== 'clippy' || P.morph < 1;
  if (!off && !shaped) return;
  const jobs = [];
  if (off) jobs.push(T(to, 220, easeOut));
  if (shaped) jobs.push(morph('clippy', 300));
  await Promise.all(jobs);
}

// ---------------------------------------------------------------- actions (the board's buttons)
const A = {};
A.greet = async () => {                                 // "Greeting" / "Wave"
  brows(-16, -6, -16, 6);
  await hop(2, 60, 260);
  sfx.pop(); balloon.show(pick(['Hi there!', 'Hello!', 'Hey! Need anything?']), null, 2400);
  await T({ rot: -12, lean: 8 }, 180, easeOut);
  for (let i = 0; i < 3; i++) { await T({ rot: 12, lean: -8 }, 210); await T({ rot: -12, lean: 8 }, 210); }
  await T({ rot: 0, lean: 0 }, 220);
  await wait(500);
};
A.attention = async () => {                             // "GetAttention": knocks on the glass
  brows(-10, -8, -10, 8);
  look(0, 0);
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 2; i++) {
      await T({ squash: 1.06, jump: 8, scale: base.scale * 1.07 }, 90, easeOut);
      sfx.knock(); rattle();
      await T({ squash: 1, jump: 0, scale: base.scale }, 130, easeOut);
      await wait(80);
    }
    await wait(380);
  }
  await wait(250);
};
A.letter = async (a) => {                               // the classic
  const activity = (a && a.activity) ? a.activity : 'writing a letter';
  const custom = activity !== 'writing a letter';
  await A.attention();
  brows(-14, -6, -14, 6); look(0, -.1);
  sfx.pop();
  balloon.show("It looks like you're " + activity + ".\n\nWould you like help?",
    custom ? ['Get help with that', 'Keep going without help', "Don't show me this tip again"]
           : ['Get help with writing the letter', 'Just type the letter without help', "Don't show me this tip again"], 10000);
  await T({ rot: -6 }, 320);
  await wait(10000);
};
A.celebrate = async () => {                             // "Congratulate"
  brows(-16, -10, -16, 10); sfx.ding();
  balloon.show(pick(['Great job!', 'You did it!', 'Nice work!', 'Congratulations!']), null, 2600);
  spawn('confetti', 70);
  for (let i = 0; i < 4; i++) await hop(1, 95, 330);
  await wait(700);
};
A.alert = async () => {                                 // "Alert": startled, "!" pops up
  T({ eyeScale: 1.25, pupilSize: .7 }, 120, easeOut); brows(-22, 0, -22, 0, 110);
  showProp('exclaim', true); sfx.tone(600, 1200, 160, 'square', .12);
  await hop(1, 75, 260);
  for (let i = 0; i < 6; i++) await T({ dx: i % 2 ? -8 : 8 }, 45, linear);
  await T({ dx: 0 }, 60);
  await wait(1300);
  showProp('exclaim', false);
};
A.think = async () => {                                 // "Thinking": eyes roll up, one brow up, taps
  look(.55, -.9); brows(-8, 12, 2, -4, 220);
  showProp('thought', true);
  await T({ rot: 6, lean: -4 }, 300);
  await taps(5, 110);
  await wait(500);
  look(0, 0); brows(-14, 0, -14, 0); showProp('thought', false);
  sfx.pop(); balloon.show(pick(["Hmm... I think I've got it!", 'Let me see...', 'Aha!']), null, 2200);
  await hop(1, 50, 260);
  await wait(1200);
};
A.explain = async () => {                               // "Explain": points at the viewer
  brows(-10, -4, -10, 4); look(0, 0);
  await T({ rot: -8, lean: 6 }, 250);
  await morph('clippyPoint', 300, easeOut);
  sfx.pop(); balloon.show(pick(['Here\'s the thing...', 'Let me explain.', 'See this?']), null, 2600);
  for (let i = 0; i < 3; i++) { await T({ jump: 14 }, 110, easeOut); await T({ jump: 0 }, 120, easeIn); await wait(150); }
  await wait(900);
  await morph('clippy', 300);
};
A.writing = async () => {                               // "Writing": pencil and paper
  showProp('write', true); part.pencil.setAttribute('transform', 'translate(-58,-166)');
  look(.45, .8); brows(-4, 6, -4, -6, 200);
  await T({ rot: 9, lean: -6 }, 300);
  const len = 900; part.scribble.setAttribute('stroke-dasharray', len); part.scribble.setAttribute('stroke-dashoffset', len);
  const prog = { t: 0 };
  const job = tween(prog, { t: 1 }, 3400, linear);
  const t0 = performance.now();
  while (prog.t < 1) {
    await wait(16);
    const rows = 4, r = Math.min(rows - 1, Math.floor(prog.t * rows)), f = (prog.t * rows) % 1;
    const x = -58 + f * 96, y = -166 + r * 26 + Math.sin((performance.now() - t0) / 40) * 4;
    part.pencil.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    part.scribble.setAttribute('stroke-dashoffset', len * (1 - prog.t));
    if (Math.floor(prog.t * 48) % 2 === 0) sfx.tick();
  }
  await job;
  await wait(300);
  showProp('write', false);
  look(0, 0); brows(-12, 0, -12, 0);
  await hop(1, 40, 240);
  sfx.pop(); balloon.show('Done!', null, 1600);
  await wait(900);
};
A.search = async () => {                                // "Searching": becomes a magnifying glass and sweeps
  sfx.whoosh(); brows(-6, 0, -6, 0);
  await morph('magnifier', 600);
  for (let i = 0; i < 2; i++) {
    look(-.8, .3); await T({ dx: -130, rot: -12 }, 520);
    look(.8, .3); await T({ dx: 130, rot: 12 }, 760);
  }
  look(0, 0); await T({ dx: 0, rot: 0 }, 360);
  await wait(150);
  await morph('clippy', 600);
  brows(-14, 0, -14, 0); sfx.pop(); balloon.show('Found it!', null, 1800);
  await hop(1, 50, 260);
  await wait(900);
};
A.save = async () => {                                  // "Save": becomes a floppy disk
  sfx.whoosh(); await morph('floppy', 550);
  sfx.pop(); balloon.show('Saved!', null, 1800);
  await T({ spin: 20 }, 220); await T({ spin: -20 }, 360); await T({ spin: 0 }, 240);
  await wait(500);
  await morph('clippy', 550);
};
A.mail = async () => {                                  // "SendMail": becomes an envelope and flies off
  sfx.whoosh(); await morph('envelope', 550);
  await wait(350);
  await T({ jump: 25, squash: .9 }, 150, easeOut);
  sfx.whoosh();
  await T({ dx: 1000, jump: 700, spin: 30, squash: 1 }, 850, easeIn);
  P.opacity = 0; await wait(700);
  P.dx = -800; P.jump = 520; P.spin = -20; P.opacity = 1;
  await T({ dx: 0, jump: 0, spin: 0 }, 900, easeOut);
  await morph('clippy', 550);
  sfx.pop(); balloon.show('Mail sent!', null, 1800);
  await hop(1, 40, 240);
  await wait(800);
};
A.artsy = async () => {                                 // "GetArtsy": cycles through shapes with sparkles
  brows(-12, -6, -12, 6);
  for (const s of ['star', 'heart', 'note']) {
    sfx.whoosh(); spawn('sparkle', 16); await morph(s, 550);
    await T({ spin: 18 }, 240); await T({ spin: -18 }, 380); await T({ spin: 0 }, 240);
    await wait(250);
  }
  spawn('sparkle', 12); await morph('clippy', 550);
};
A.techy = async () => {                                 // "GetTechy": becomes an atom and spins
  sfx.whoosh(); await morph('atom', 600);
  const spin = T({ spin: 720 }, 2200);
  for (let i = 0; i < 4; i++) { look(i % 2 ? .7 : -.7, 0); await wait(500); }
  await spin; P.spin = 0;
  await morph('clippy', 600);
  sfx.pop(); balloon.show('Beep boop.', null, 1600);
  await wait(800);
};
A.idea = async () => {                                  // light bulb moment
  sfx.whoosh(); await morph('bulb', 550);
  showProp('glow', true); sfx.ding(); brows(-16, -6, -16, 6);
  await T({ jump: 35 }, 150, easeOut); await T({ jump: 0 }, 420, easeOutBounce);
  await wait(1300);
  showProp('glow', false);
  await morph('clippy', 550);
  sfx.pop(); balloon.show('I have an idea!', null, 2000);
  await wait(900);
};
A.confused = async () => {                              // becomes a question mark
  sfx.whoosh(); await morph('question', 550);
  brows(-8, 14, 0, -4); look(.4, -.3);
  await T({ rot: 8 }, 300);
  await wait(500); look(-.4, -.3); await T({ rot: -8 }, 500);
  await wait(700);
  await morph('clippy', 550);
};
A.check = async () => {                                 // check mark
  sfx.whoosh(); await morph('check', 500); sfx.ding(); spawn('sparkle', 12);
  brows(-14, -8, -14, 8);
  await wait(1500);
  await morph('clippy', 500);
};
A.love = async () => {
  sfx.whoosh(); await morph('heart', 550); spawn('heart', 14); brows(-12, -10, -12, 10);
  for (let i = 0; i < 3; i++) { await T({ squash: 1.08 }, 190); await T({ squash: .95 }, 190); }
  await T({ squash: 1 }, 150);
  await wait(400);
  await morph('clippy', 550);
};
A.dance = async () => {
  for (let i = 0; i < 8; i++) {
    const s = i % 2 ? 1 : -1;
    brows(i % 2 ? -14 : -4, s * 8, i % 2 ? -4 : -14, -s * 8, 120);
    T({ lean: s * 14, rot: -s * 6 }, 210);
    await T({ squash: .9 }, 100, easeOut);
    sfx.tone(300 + (i % 4) * 60, 300, 90, 'triangle', .1);
    await T({ squash: 1.06, jump: 32 }, 110, easeOut);
    await T({ jump: 0 }, 100, easeIn);
  }
  await T({ lean: 0, rot: 0, squash: 1 }, 220);
};
A.laugh = async () => {
  brows(-12, -8, -12, 8); state.lidLock = 1;
  T({ eyeOpenL: .3, eyeOpenR: .3 }, 120);
  for (let i = 0; i < 7; i++) { await T({ squash: .92, rot: 4 }, 90); await T({ squash: 1.04, rot: -2 }, 90); }
  await T({ squash: 1, rot: 0 }, 150);
  state.lidLock = 0;
};
A.nod = async () => {
  brows(-10, 0, -10, 0);
  for (let i = 0; i < 3; i++) { await T({ squash: .92, rot: 0 }, 150, easeInOut); await T({ squash: 1.02 }, 150, easeInOut); }
  await T({ squash: 1 }, 120);
};
A.no = async () => {
  brows(2, 10, 2, -10); look(0, .1);
  for (let i = 0; i < 3; i++) { await T({ lean: 14, rot: -6 }, 160); await T({ lean: -14, rot: 6 }, 160); }
  await T({ lean: 0, rot: 0 }, 160);
};
A.sad = async () => {
  brows(-4, -18, -4, 18, 300); look(0, .6);
  await T({ rot: 8, lean: -4, squash: .96 }, 500);
  sfx.tone(400, 200, 500, 'sine', .1);
  await wait(2200);
};
A.wink = async () => {
  state.lidLock = 1; brows(-14, 0, -4, 0);
  await T({ eyeOpenR: .06 }, 90, easeOut); sfx.tick();
  await wait(500);
  await T({ eyeOpenR: 1 }, 120, easeOut);
  state.lidLock = 0;
};
A.rollEyes = async () => {
  brows(4, 6, 4, -6);
  const o = { a: 0 };
  const job = tween(o, { a: TAU }, 900, easeInOut);
  while (o.a < TAU) { P.pupilX = Math.sin(o.a) * .85; P.pupilY = -Math.cos(o.a) * .85; await wait(16); }
  await job; P.pupilX = 0; P.pupilY = 0;
  await wait(300);
};
A.pile = async () => {                                  // "IdleRopePile": collapses into a coil and springs back
  sfx.whoosh(); brows(-6, 0, -6, 0);
  await T({ jump: 30 }, 130, easeOut);
  await morph('pile', 380, easeIn);
  await T({ jump: 0 }, 220, easeOutBounce);
  look(0, -.6);
  await wait(1600);
  brows(-14, -6, -14, 6); sfx.boing();
  await morph('clippy', 450, easeOutBack);
  await hop(1, 50, 260);
};
A.watch = async () => {                                 // looks at a wristwatch, taps
  showProp('watch', true);
  look(-.7, .85); brows(-8, 6, -4, 0);
  await T({ rot: -6, lean: 4 }, 300);
  await wait(700);
  await taps(3, 110);
  await wait(800);
  showProp('watch', false);
};
A.lookAround = async () => {                            // "Idle1_1"
  look(-.9, -.2); brows(-10, -6, -2, 0); await T({ rot: -7 }, 350);
  await wait(700);
  look(.9, -.2); brows(-2, 0, -10, 6); await T({ rot: 7 }, 520);
  await wait(700);
  look(0, 0); brows(0, 0, 0, 0); await T({ rot: 0 }, 300);
};
A.browRaise = async () => {                             // "IdleEyeBrowRaise"
  brows(-18, -6, -18, 6, 180); await wait(260);
  brows(0, 0, 0, 0, 180); await wait(220);
  brows(-18, -6, -18, 6, 180); await wait(900);
  brows(0, 0, 0, 0, 220); await wait(200);
};
A.sway = async () => {                                  // "IdleSideToSide"
  for (let i = 0; i < 2; i++) { await T({ lean: 12, dx: 18 }, 520); await T({ lean: -12, dx: -18 }, 940); }
  await T({ lean: 0, dx: 0 }, 420);
};
A.tap = async () => { await taps(4, 110); await wait(200); };
A.snooze = async () => {                                // "IdleSnooze" (stays asleep until woken)
  state.mode = 'sleep'; state.lidLock = 1; balloon.hide();
  brows(2, 6, 2, -6, 700); look(0, .3);
  await T({ eyeOpenL: .08, eyeOpenR: .08, rot: 9, lean: -5 }, 950);
  state.zzz = true;
};
async function wakeUp() {
  state.zzz = false; state.lidLock = 0; state.mode = 'idle';
  brows(-16, -4, -16, 4, 150);
  await T({ eyeOpenL: 1, eyeOpenR: 1, rot: 0, lean: 0 }, 220, easeOut);
  await hop(1, 35, 230);
}
A.wake = async () => { if (state.mode === 'sleep') await wakeUp(); else await A.browRaise(); };
A.goodbye = async () => {                               // "GoodBye": twirls away
  sfx.pop(); balloon.show('Bye!', null, 1200); brows(-6, 8, -6, -8);
  await T({ rot: -15 }, 200); await T({ rot: 15 }, 250); await T({ rot: -10 }, 250);
  sfx.whoosh();
  await T({ spin: 900, scale: .01, jump: 140 }, 720, easeIn);
  P.opacity = 0; state.mode = 'hidden';
};
A.show = async () => {                                  // "Show"
  P.opacity = 1; P.spin = 0; P.scale = .01; P.jump = 0; P.rot = 0; P.lean = 0; state.mode = 'idle';
  sfx.boing();
  await T({ scale: base.scale }, 650, easeOutBack);
  brows(-14, 0, -14, 0);
  await hop(1, 40, 240);
};
A.hide = A.goodbye;
A.look = async (a) => {
  const dirs = { camera: [0, 0], left: [-.9, .1], right: [.9, .1], up: [0, -.9], down: [0, .85], upLeft: [-.8, -.7], upRight: [.8, -.7] };
  const d = dirs[(a && a.dir) || 'camera'] || dirs.camera;
  gazeHold.x = d[0]; gazeHold.y = d[1];
  look(d[0], d[1], 220);
  brows(-6, 0, -6, 0); await wait(700); brows(0, 0, 0, 0, 300);
};
A.move = async (a) => {
  const tx = a && a.x != null ? +a.x : POS[(a && a.pos) || 'centerLeft'];
  if (tx == null) return;
  const dir = Math.sign(tx - P.x) || 1, dist = Math.abs(tx - P.x);
  base.x = tx;
  if (dist < 6) return;
  const hops = Math.max(1, Math.round(dist / 170));
  look(dir * .8, .1); brows(-8, 0, -8, 0);
  for (let i = 0; i < hops; i++) {
    const nx = P.x + (tx - P.x) / (hops - i);
    tween(P, { x: nx, y: groundY(nx) }, 330, easeInOut);
    T({ lean: -dir * 11 }, 150);
    await T({ squash: .85 }, 90, easeOut);
    sfx.boing();
    await T({ squash: 1.1, jump: 75 }, 160, easeOut);
    await T({ jump: 0 }, 160, easeIn);
    await T({ squash: 1, lean: 0 }, 110, easeOut);
  }
  look(0, 0);
};
A.size = async (a) => { const s = clamp(+(a && a.scale) || 1.15, .3, 3); base.scale = s; await T({ scale: s }, 420, easeOutBack); };
A.say = async (a) => {
  const text = (a && a.text) || 'Would you like help?';
  const ms = a && a.ms ? +a.ms : clamp(2500 + text.length * 70, 3000, 25000);
  brows(-12, 0, -12, 0); look(0, 0); sfx.pop();
  balloon.show(text, a && a.options, ms);
  await T({ rot: -5 }, 250); await wait(250); await T({ rot: 0 }, 250);
  await wait(900); brows(0, 0, 0, 0, 300);
};
A.sixseven = async () => {                              // "6-7": cupped hands seesawing, the meme gesture
  brows(-14, -8, -14, 8); look(0, .2);
  await morph('clippyScales', 320, easeOut);
  for (let i = 0; i < 2; i++) {
    spawn('label', 1, { text: '6', dx: -225, dy: 150, rot: -12, color: '#ffd54a', size: 125, vy: -40 });
    sfx.tone(330, 330, 170, 'triangle', .14); look(-.7, .3);
    await T({ rot: -14, lean: 7, squash: 1.04, jump: 12 }, 230, easeOut);
    await T({ jump: 0 }, 120, easeIn);
    await wait(120);
    spawn('label', 1, { text: '7', dx: 225, dy: 150, rot: 12, color: '#7ec8ff', size: 125, vy: -40 });
    sfx.tone(392, 392, 170, 'triangle', .14); look(.7, .3);
    await T({ rot: 14, lean: -7, squash: .98, jump: 12 }, 230, easeOut);
    await T({ jump: 0 }, 120, easeIn);
    await wait(120);
  }
  look(0, 0); brows(-18, -10, -18, 10);
  await T({ rot: 0, lean: 0, squash: 1 }, 180, easeOut);
  sfx.pop(); balloon.show('6-7!', null, 2000);
  spawn('label', 1, { text: '6-7', dx: 0, dy: -170, size: 120, color: '#ffffff', ttl: 1.4 });
  await hop(1, 70, 300);
  await wait(500);
  await morph('clippy', 350);
  await wait(300);
};
A.hideBalloon = async () => { balloon.hide(); };
A.stop = async () => {};
A.setting = async (a) => { if (a && a.key in settings) settings[a.key] = !!a.value; };

const QUIET = new Set(['look', 'size', 'setting', 'hideBalloon', 'say']);   // don't clear the balloon / props
const IDLE_ACTS = ['lookAround', 'browRaise', 'sway', 'tap', 'watch', 'pile', 'lookAround', 'browRaise', 'rollEyes', 'artsy', 'techy'];

// ---------------------------------------------------------------- runner
let runId = 0;
async function run(name, args) {
  const fn = A[name];
  if (!fn) { console.warn('unknown action', name); return; }
  const token = ++runId;
  cancelActionTweens();
  if (!QUIET.has(name)) { balloon.hide(); hideAllProps(); }
  state.running = name; state.lastActivity = performance.now(); state.gazeLock = 1;
  try {
    if (state.mode === 'hidden' && name !== 'show' && name !== 'goodbye' && !QUIET.has(name)) await A.show();
    if (state.mode === 'sleep' && name !== 'snooze' && !QUIET.has(name)) await wakeUp();
    if (!QUIET.has(name)) await settle();
    await fn(args || {});
    if (token === runId && !QUIET.has(name)) await rest();
  } catch (e) {
    if (!(e instanceof Cancelled)) console.error('action ' + name + ' failed', e);
  } finally {
    if (token === runId) { state.running = null; state.gazeLock = 0; state.lastActivity = performance.now(); if (!QUIET.has(name)) hideAllProps(); }
  }
}

// ---------------------------------------------------------------- ambient behaviour
function scheduleBlink() {
  setTimeout(async () => {
    if (!state.lidLock && state.mode !== 'sleep' && P.morph >= 1) {
      try {
        await tween(P, { eyeOpenL: .06, eyeOpenR: .06 }, 80, easeOut, true);
        await tween(P, { eyeOpenL: 1, eyeOpenR: 1 }, 110, easeOut, true);
        if (Math.random() < .2) { await tween(P, { eyeOpenL: .06, eyeOpenR: .06 }, 80, easeOut, true); await tween(P, { eyeOpenL: 1, eyeOpenR: 1 }, 110, easeOut, true); }
      } catch (e) {}
    }
    scheduleBlink();
  }, rnd(2500, 6000));
}
function scheduleGlance() {
  setTimeout(async () => {
    if (!state.gazeLock && state.mode === 'idle' && !state.running) {
      look(gazeHold.x + rnd(-.45, .45), gazeHold.y + rnd(-.35, .35), 260);
      await wait(rnd(600, 1500), true);
      if (!state.gazeLock) look(gazeHold.x, gazeHold.y, 300);
    }
    scheduleGlance();
  }, rnd(2500, 6500));
}
let nextIdleIn = rnd(10000, 22000);
setInterval(() => {
  if (state.zzz && state.mode === 'sleep') spawn('z', 1);
  if (!settings.autoIdle || state.mode !== 'idle' || state.running) return;
  if (performance.now() - state.lastActivity > nextIdleIn) { nextIdleIn = rnd(12000, 30000); run(pick(IDLE_ACTS)); }
}, 1000);
setInterval(() => { if (!balloonEl || balloonEl.hidden) return; balloon.place(); }, 120);

// ---------------------------------------------------------------- public API
function init(opts) {
  build(opts);
  if (opts.pos && POS[opts.pos] != null) base.x = POS[opts.pos];
  if (opts.x != null) base.x = +opts.x;
  if (opts.scale) base.scale = +opts.scale;
  P.x = base.x; P.y = groundY(base.x); P.scale = base.scale;
  if (opts.autoIdle != null) settings.autoIdle = !!opts.autoIdle;
  if (opts.sound != null) settings.sound = !!opts.sound;
  if (opts.lock) for (const k of opts.lock) lockedSettings.add(k);
  applyShape(shapes.clippy);
  startLoop();
  scheduleBlink(); scheduleGlance();
  setTimeout(() => { if (!state.running) run('browRaise'); }, 600);   // little hello, unless the board already asked for something
}
const lockedSettings = new Set();
function applyState(s) {
  if (!s) return;
  if (s.settings) for (const k in s.settings) if (k in settings && !lockedSettings.has(k)) settings[k] = !!s.settings[k];
  if (s.scale) { base.scale = +s.scale; P.scale = base.scale; }
  if (s.pos && POS[s.pos] != null) { base.x = POS[s.pos]; P.x = base.x; P.y = groundY(base.x); }
  if (s.mode === 'hidden' && state.mode !== 'hidden') { state.mode = 'hidden'; P.opacity = 0; P.scale = .01; }
  if (s.mode === 'sleep' && state.mode !== 'sleep') run('snooze');
}
global.Clippy = { init, run, applyState, actions: Object.keys(A), pose: P, settings, state, shapes, balloon, spawn, base };
})(window);
