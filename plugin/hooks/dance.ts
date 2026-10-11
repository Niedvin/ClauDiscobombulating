export const DANCE_MS = 15000
export const REVEAL_MS = 800
const BEAT = 0.5
const BOMB_AT = 12.5
const BOOM_AT = 12.9
const DEF = 0x01000000
const HOLE = -2
const CLAWD = 0xd77757
const SCORCHED = 0x2b1d18
const SPACE = 0x20

export type Head = { name: string; colors: number[]; tail: string; update: string; border: number }
type Paint = (x: number, y: number) => number
type Pose = { cx: number; lift: number; bw: number; bh: number; armL: number; armR: number; legs: number[]; blink: boolean; look: number; back: boolean; paint: Paint; eye: number; pocket: boolean }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

function hash(a: number, b: number) {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

function noise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const sx = (x - xi) ** 2 * (3 - 2 * (x - xi))
  const sy = (y - yi) ** 2 * (3 - 2 * (y - yi))
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), sx), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), sx), sy)
}

function hue(h: number, s = 0.85, l = 0.6) {
  const deg = ((h % 360) + 360) % 360
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + deg / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return (f(0) << 16) | (f(8) << 8) | f(4)
}

const shade = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)

const mix = (a: number, b: number, k: number) => {
  const ch = (s: number) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, k))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

const FIRE = [0x000000, 0x2a0500, 0x7a1000, 0xc82a00, 0xff6a00, 0xffb000, 0xffe680, 0xffffff]
function fireColor(i: number) {
  const x = clamp01(i) * (FIRE.length - 1)
  const k = Math.floor(x)
  return mix(FIRE[k]!, FIRE[Math.min(FIRE.length - 1, k + 1)]!, x - k)
}

const orange: Paint = () => CLAWD
const stripes = (t: number, speed: number): Paint => (_x, y) => hue(y * 14 - t * speed)
const diagonal = (t: number, speed: number): Paint => (x, y) => hue((x + y) * 9 - t * speed)
const flash = (n: number): Paint => () => hue(n * 67, 0.9, 0.62)

function swing(b: number, f: number, a: number, c: number) {
  const k = clamp01(f * 4)
  return b % 2 ? lerp(c, a, k) : lerp(a, c, k)
}

function pose(t: number, W: number, feet: number): Pose {
  const B = t / BEAT
  const b = Math.floor(B)
  const f = B - b
  const mid = W / 2
  const hop = Math.sin(f * Math.PI)
  const p: Pose = { cx: mid, lift: 0, bw: 18, bh: 12, armL: 0, armR: 0, legs: [3, 3, 3, 3], blink: false, look: 0, back: false, paint: orange, eye: HOLE, pocket: false }
  if (t < 1) {
    const k = clamp01(t / 0.7)
    p.lift = (1 - k * k) * (feet + 20)
    p.armL = p.armR = 80 * (1 - k)
    if (t < 0.7) p.legs = [1, 1, 1, 1]
    else {
      const s = 1 - (t - 0.7) / 0.3
      p.bw = 18 + 4 * s
      p.bh = 12 - 3 * s
    }
  } else if (t < 3.5) {
    const sq = (1 - f) ** 3
    p.lift = hop * 2
    p.bw = 18 + 2 * sq
    p.bh = 12 - 2 * sq
    p.armL = swing(b, f, -40, 70)
    p.armR = swing(b, f, 70, -40)
    if (f < 0.5) p.legs = b % 2 ? [3, 1, 3, 1] : [1, 3, 1, 3]
    p.blink = b === 5 && f < 0.3
    if (t >= 2.5) p.paint = stripes(t, 300)
  } else if (t < 6) {
    const u = ((t - 3.5) * 2 * Math.PI) / 1.25
    p.cx = mid + Math.sin(u) * Math.max(0, (W - 26) / 2)
    p.look = Math.sign(Math.cos(u))
    p.lift = hop * 1.5
    p.legs = Math.floor(B * 2) % 2 ? [3, 1, 3, 1] : [1, 3, 1, 3]
    p.armL = 35 * Math.cos(u)
    p.armR = -35 * Math.cos(u)
    p.paint = diagonal(t, 400)
  } else if (t < 7.5) {
    const u = (t - 6) / 1.5
    const phi = u * 4 * Math.PI
    const c = Math.cos(phi)
    p.bw = Math.max(3, 18 * Math.abs(c))
    p.back = c < 0
    p.look = Math.sin(phi) * 4
    p.lift = Math.sin(u * Math.PI) * 6
    p.armL = p.armR = 45
    p.paint = flash(Math.floor(phi / Math.PI))
  } else if (t < 9.5) {
    p.lift = hop * 14
    p.bw = lerp(21, 16, hop)
    p.bh = lerp(9, 14, hop)
    p.armL = p.armR = lerp(-30, 65, hop)
    if (hop > 0.3) p.legs = [1, 1, 1, 1]
    p.paint = stripes(t, 600)
  } else if (t < 11.5) {
    p.cx = mid + swing(b, f, -2, 2)
    p.lift = hop
    p.armL = swing(b, f, 70, -55)
    p.armR = swing(b, f, -55, 70)
    p.blink = b % 4 === 3 && f < 0.25
    p.paint = flash(b)
  } else if (t < BOMB_AT) {
    const w = Math.sin(t * Math.PI * 8)
    p.cx = mid + w * 1.5
    p.lift = Math.abs(w)
    p.armL = 40 + 40 * w
    p.armR = 40 - 40 * w
    p.legs = Math.floor(t * 8) % 2 ? [3, 2, 3, 2] : [2, 3, 2, 3]
    p.paint = diagonal(t, 900)
  } else if (t < BOOM_AT) {
    const u = t - BOMB_AT
    p.pocket = true
    p.look = 1
    p.blink = u > 0.28 && u < 0.34
    if (u > 0.3) {
      p.armL = p.armR = 75 + 12 * Math.sin(t * 60)
      p.cx = mid + Math.sin(t * 70) * 0.6
    }
  } else {
    const te = t - BOOM_AT
    p.lift = 70 * te + 60 * te * te
    p.cx = mid - 6 * te
    p.bw = 16
    p.bh = 14
    p.armL = 80 * Math.sin(te * 30)
    p.armR = -p.armL
    p.legs = Math.floor(te * 16) % 2 ? [3, 1, 3, 1] : [1, 3, 1, 3]
    p.paint = () => SCORCHED
    p.eye = 0xffffff
  }
  return p
}

// pixel = 1 column × half a row, so the 2×-scaled Clawd keeps the proportions of the CLI logo — 2026-10-11
function drawClawd(put: (x: number, y: number, c: number) => void, p: Pose, feet: number) {
  const bw = Math.max(1, Math.round(p.bw))
  const bh = Math.max(1, Math.round(p.bh))
  const x0 = Math.round(p.cx - bw / 2)
  const bot = Math.round(feet - 3 - p.lift)
  const top = bot - bh + 1
  const paint = (x: number, y: number) => put(x, y, p.paint(x, y))
  for (let y = top; y <= bot; y++) for (let x = x0; x < x0 + bw; x++) paint(x, y)
  if (p.pocket) for (let y = bot - 4; y < bot; y++) for (let x = x0 + bw - 7; x < x0 + bw - 2; x++) put(x, y, shade(p.paint(x, y), y === bot - 4 ? 0.5 : 0.75))
  const legW = bw >= 10 ? 2 : 1
  ;[1, 4, 12, 15].forEach((lx, k) => {
    const x = x0 + Math.round((lx * bw) / 18)
    for (let y = bot + 1; y <= bot + (p.legs[k] ?? 3); y++) for (let i = 0; i < legW; i++) paint(x + i, y)
  })
  if (bw > 6) {
    const sy = top + Math.round((bh * 7) / 12)
    for (const [side, deg] of [[-1, p.armL], [1, p.armR]] as const) {
      const a = (deg * Math.PI) / 180
      const len = 1.5 + 9 * Math.max(0, Math.sin(a))
      const ax = side < 0 ? x0 - 1 : x0 + bw
      const dx = side * Math.cos(a)
      const dy = -Math.sin(a)
      const reach = Math.ceil(len + 2)
      for (let y = sy - reach; y <= sy + reach; y++) {
        for (let x = ax - reach; x <= ax + reach; x++) {
          if (side < 0 ? x >= x0 : x < x0 + bw) continue
          const qx = x - ax
          const qy = y - sy
          const s = Math.max(0, Math.min(len, qx * dx + qy * dy))
          if ((qx - s * dx) ** 2 + (qy - s * dy) ** 2 <= 1.6) paint(x, y)
        }
      }
    }
  }
  if (p.back || bw < 4) return
  const ew = bw >= 12 ? 2 : 1
  const eh = Math.max(1, Math.round((bh * 4) / 12))
  const ey = top + Math.round((bh * 3) / 12)
  const inset = Math.round((bw * 3) / 18)
  const sh = Math.round(p.look)
  for (const ex of [x0 + inset + sh, x0 + bw - inset - ew + sh]) {
    for (let y = p.blink ? ey + eh - 1 : ey; y < ey + eh; y++) {
      for (let i = 0; i < ew; i++) if (ex + i >= x0 && ex + i < x0 + bw) put(ex + i, y, p.eye)
    }
  }
}

function drawBall(put: (x: number, y: number, c: number) => void, cx: number, cy: number, t: number) {
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 > 21) continue
      const fx = Math.floor((dx + t * 6) / 2)
      const fy = Math.floor((dy + 5) / 2)
      const h = hash(fx * 7 + fy * 131, Math.floor(t * 8))
      const c = h < 0.1 ? 0xffffff : h < 0.18 ? hue(h * 3600, 0.9, 0.7) : (fx + fy) & 1 ? 0xb8bccb : 0x7a7f92
      put(cx + dx, cy + dy, d2 > 13 && c !== 0xffffff ? shade(c, 0.6) : c)
    }
  }
}

const FUSE = [[1, -6], [2, -7], [2, -8], [3, -9], [4, -9]] as const

function drawBomb(put: (x: number, y: number, c: number) => void, bx: number, by: number, burn: number) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 > 13) continue
      const isShine = (dx === -2 && dy === -1) || (dx === -1 && dy === -2) || (dx === -2 && dy === -2)
      put(bx + dx, by + dy, isShine ? 0xc8c8d8 : d2 > 8 ? 0x55556a : 0x2e2e38)
    }
  }
  for (const [dx, dy] of [[0, -4], [1, -4], [0, -5], [1, -5]] as const) put(bx + dx, by + dy, 0x8a8a9a)
  FUSE.slice(0, Math.ceil(FUSE.length * (1 - burn))).forEach(([dx, dy]) => put(bx + dx, by + dy, 0xc9a26b))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array) {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out.push(B64[n >> 18]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '='))
  }
  return out.join('')
}

export const headRows = (head?: Head) => (head ? (head.update ? 4 : 3) : 0)

// the pane's banner, drawn into the stage so the blast can cover it too — 2026-10-11
function drawHead(set: (c: number, r: number, cp: number, fg: number, bg?: number) => void, W: number, head: Head) {
  const rows = headRows(head)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < W; c++) {
      const isTop = r === 0
      const isBot = r === rows - 1
      const edge = c === 0 || c === W - 1
      const cp = isTop ? (c === 0 ? 0x256d : c === W - 1 ? 0x256e : 0x2500) : isBot ? (c === 0 ? 0x2570 : c === W - 1 ? 0x256f : 0x2500) : edge ? 0x2502 : SPACE
      set(c, r, cp, head.border)
    }
  }
  ;[...head.name].forEach((ch, k) => set(1 + k, 1, ch.codePointAt(0) ?? SPACE, head.colors[k] ?? 0xcccccc))
  ;[...head.tail].forEach((ch, k) => set(1 + head.name.length + k, 1, ch.codePointAt(0) ?? SPACE, 0x7a7a7a))
  if (head.update) [...head.update].forEach((ch, k) => set(1 + k, 2, ch.codePointAt(0) ?? SPACE, 0xf0b429))
}

export function danceCells(W: number, rows: number, t: number, word = 'BOOM!', head?: Head) {
  const H = rows
  const top = headRows(head)
  const SH = H - top
  const PH = H * 2
  const feet = 2 * (H - 2) - 1
  const mid = Math.floor(W / 2)
  const te = t - BOOM_AT
  const g = new Uint32Array(W * rows * 3)
  for (let i = 0; i < W * rows; i++) g.set([SPACE, DEF, DEF], i * 3)
  const isFree = (c: number, r: number) => c >= 0 && c < W && r >= top && r < H - 2 && g[(r * W + c) * 3] === SPACE
  const set = (c: number, r: number, cp: number, fg: number, bg = DEF) => {
    if (c >= 0 && c < W && r >= 0 && r < H) g.set([cp, fg, bg], (r * W + c) * 3)
  }
  if (head) drawHead(set, W, head)

  for (let k = 0; k < 3; k++) {
    const to = mid + Math.sin(t * 1.1 + k * 2.09) * W * 0.55
    const color = hue(k * 120 + t * 60, 0.8, 0.42)
    for (let r = top + 6; r < H - 2; r++) {
      const c = Math.round(lerp(mid, to, (r - top - 4) / Math.max(1, SH - 7)))
      if (isFree(c, r)) set(c, r, 0xb7, color)
    }
  }
  const sparkles = Math.round((W * SH) / 45)
  for (let i = 0; i < sparkles; i++) {
    const period = 0.9 + hash(i, 1) * 0.6
    const at = t / period + hash(i, 2)
    const cyc = Math.floor(at)
    const life = at - cyc
    const glyph = life < 0.15 ? 0xb7 : life < 0.3 ? 0x2b : life < 0.55 ? 0x2726 : life < 0.7 ? 0x2b : life < 0.85 ? 0xb7 : 0
    const c = Math.floor(hash(i, cyc * 3 + 7) * W)
    const r = top + Math.floor(hash(i, cyc * 5 + 11) * (SH - 2))
    if (glyph && isFree(c, r)) set(c, r, glyph, hue(hash(i, cyc) * 360, 0.85, 0.72))
  }
  for (let nb = 3; nb < BOMB_AT / BEAT; nb++) {
    const age = t - nb * BEAT
    if (age < 0 || age > 1.6) continue
    const q = pose(nb * BEAT, W, feet)
    const c = Math.round(q.cx + (nb % 2 ? 1 : -1) * (q.bw / 2 + 4) + Math.sin(age * 5 + nb) * 1.5)
    const r = Math.round((feet - 3 - q.lift - q.bh) / 2 - age * 5)
    if (isFree(c, r)) set(c, r, nb % 3 ? 0x266a : 0x266b, hue(nb * 53, 0.9, 0.72))
  }
  set(mid, top, 0x2502, 0x6c6c7c)

  const now = pose(t, W, feet)
  for (let r = H - 2; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ty = r - (H - 2)
      const tile = (Math.floor(c / 4) + ty) % 2
      let bg = ty === 0 ? (tile ? 0x2c2c35 : 0x24242c) : tile ? 0x1e1e25 : 0x19191f
      if (ty === 0 && now.lift > 1 && Math.abs(c + 0.5 - now.cx) < now.bw / 2) bg = shade(bg, 0.5)
      set(c, r, SPACE, DEF, bg)
    }
  }

  const px = new Int32Array(W * PH).fill(-1)
  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && x < W && y >= 0 && y < PH) px[y * W + x] = c
  }
  const ballY = 2 * top + 7
  const bx = Math.round(mid + 9)
  const by = feet - 3
  if (t >= 1) drawBall(put, mid, ballY, t)
  if (te < 0) drawClawd(put, now, feet)
  if (t < 1) drawBall(put, mid, ballY, t)
  let fuseTip: readonly [number, number] | undefined
  if (t >= BOMB_AT + 0.08 && te < 0) {
    const k = clamp01((t - BOMB_AT - 0.08) / 0.25)
    const x = Math.round(lerp(mid + 4, bx, k))
    const y = Math.round(lerp(feet - 5, by, k) - 8 * Math.sin(k * Math.PI))
    const burn = clamp01((t - BOMB_AT - 0.08) / (BOOM_AT - BOMB_AT - 0.08))
    drawBomb(put, x, y, burn)
    const tip = FUSE[Math.min(FUSE.length - 1, Math.ceil(FUSE.length * (1 - burn)))] ?? [0, -5]
    fuseTip = [x + tip[0], y + tip[1]]
  }

  if (te >= 0) {
    const reach = Math.hypot(W, PH) * 1.25
    const ring = reach * (1 - (1 - clamp01(te / 0.3)) ** 2)
    const heat = te < 1.2 ? 1 : clamp01(1 - (te - 1.2) / 0.6)
    const boost = te < 0.12 ? (1 - te / 0.12) * 0.9 : 0
    const frame = Math.floor(t * 25)
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - bx, y - by)
        if (d > ring * (0.85 + 0.15 * noise(x * 0.3, y * 0.3 + frame))) continue
        const n = noise(x * 0.18, y * 0.35 + t * 9) * 0.6 + noise(x * 0.5, y * 0.9 + t * 16) * 0.4
        let i = n * 0.95 + (y / PH) * 0.5 - 0.1 - (1 - heat) * 1.6 + boost
        if (heat < 1 && heat > 0 && hash(x * 977 + y, frame) < 0.012) i = 0.62
        px[y * W + x] = fireColor(i)
      }
    }
    if (te < 0.9) drawClawd(put, now, feet)
  }

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const tp = px[2 * r * W + c] ?? -1
      const bt = px[(2 * r + 1) * W + c] ?? -1
      if (tp >= 0 && bt >= 0) set(c, r, tp === bt ? 0x2588 : 0x2580, tp, tp === bt ? DEF : bt)
      else if (tp >= 0) set(c, r, 0x2580, tp)
      else if (bt >= 0) set(c, r, 0x2584, bt)
      else if (tp === HOLE || bt === HOLE) set(c, r, SPACE, DEF)
    }
  }
  if (fuseTip) {
    const k = Math.floor(t * 20) % 3
    set(fuseTip[0], Math.floor(fuseTip[1] / 2), [0x2726, 0x2a, 0x2b][k]!, [0xffffff, 0xffd23f, 0xff8c1a][k]!)
  }
  if (te >= 0.05 && te < 1.0) {
    const text = ` ${word} `
    const jitter = te < 0.3 ? Math.round(Math.sin(te * 80) * (1 - te / 0.3)) : 0
    const c0 = Math.max(0, Math.min(W - text.length, Math.round(W / 2 - text.length / 2) + jitter))
    const r = top + Math.floor(SH / 2)
    ;[...text].forEach((ch, k) => set(c0 + k, r, ch.codePointAt(0) ?? SPACE, k % 2 ? 0xffe14d : 0xffffff, 0x000000))
  }
  const shift = te >= 0 && te < 0.35 ? Math.round(Math.sin(te * 95) * 2 * (1 - te / 0.35)) : 0
  if (shift) {
    const src = g.slice()
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const from = c - shift
        g.set(from >= 0 && from < W ? src.subarray((r * W + from) * 3, (r * W + from) * 3 + 3) : [SPACE, DEF, 0x000000], (r * W + c) * 3)
      }
    }
  }
  const bytes = new Uint8Array(g.length * 4)
  const view = new DataView(bytes.buffer)
  g.forEach((v, i) => view.setUint32(i * 4, v, true))
  return base64(bytes)
}
