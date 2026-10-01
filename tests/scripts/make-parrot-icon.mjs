// 生成 64×64 像素风我的世界鹦鹉图标（红蓝黄绿四色 + 白眼），1024 画布放大保持像素锐度
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
const S = 1024, PX = 16; // 16×16 像素艺术放大到 1024
const buf = Buffer.alloc(S * S * 4);
const set = (gx, gy, r, g, b) => { for (let y = gy * PX; y < (gy + 1) * PX; y++) for (let x = gx * PX; x < (gx + 1) * PX; x++) { const i = (y * S + x) * 4; buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255; } };
const P = { red: [210, 52, 47], blue: [52, 120, 210], green: [92, 180, 70], yellow: [235, 190, 60], dark: [40, 34, 30], white: [245, 245, 245], gray: [90, 86, 80], beak: [140, 96, 40] };
// 16×16 网格鹦鹉（侧面站立，红身蓝翅黄头灰喙）——依据 Minecraft 鹦鹉贴图风格
const grid = [
  '................',
  '......yyyy......',
  '.....yyyyyy.....',
  '.....ywwyy......',
  '.....wdwwy......',
  '......yyy.......',
  '.....bbbbb......',
  '....rrrrrrr.....',
  '...rrrrrrrrr....',
  '..bgrrrrrrrr....',
  '..bgrrrrrrrrr...',
  '..bb.rrrrrrr....',
  '......rrrr......',
  '.....yyy.y......',
  '....yyy...y.....',
  '................',
];
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
  const ch = grid[y][x];
  if (ch === '.') continue;
  const c = P[{ r: 'red', b: 'blue', g: 'green', y: 'yellow', w: 'white', d: 'dark', k: 'gray', o: 'beak' }[ch] || 'gray'];
  set(x, y, c[0], c[1], c[2]);
}
function crc32(b2) { let t = crc32.table; if (!t) { t = crc32.table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } } let c = -1; for (let i = 0; i < b2.length; i++) c = t[(c ^ b2[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const png = Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'resources', 'icons', 'icon_1024.png'), png);
console.log('parrot icon written');
