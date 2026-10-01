// 生成应用图标：纯 JS 逐像素绘制圆角方块 + 等距立方体 → PNG（1024px）
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const S = 1024; // 输出尺寸（2x 超采样 2048 → 缩到 1024）
const D = 2048;
const buf = Buffer.alloc(D * D * 4);

const lerp = (a, b, t) => a + (b - a) * t;
function px(x, y, r, g, b, a) {
  const i = (y * D + x) * 4;
  const sa = buf[i + 3] / 255, da = a / 255;
  const oa = da + sa * (1 - da);
  if (oa <= 0) return;
  buf[i] = (r * da + buf[i] * sa * (1 - da)) / oa;
  buf[i + 1] = (g * da + buf[i + 1] * sa * (1 - da)) / oa;
  buf[i + 2] = (b * da + buf[i + 2] * sa * (1 - da)) / oa;
  buf[i + 3] = oa * 255;
}
function inRounded(x, y, x0, y0, x1, y1, rad) {
  const cx = Math.max(x0 + rad, Math.min(x, x1 - rad));
  const cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
  return (x >= x0 && x <= x1 && y >= y0 && y <= y1) && ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad || (x >= x0 + rad && x <= x1 - rad) || (y >= y0 + rad && y <= y1 - rad));
}
// 背景：对角渐变 + 圆角矩形
for (let y = 0; y < D; y++) {
  for (let x = 0; x < D; x++) {
    const m = 80;
    if (!inRounded(x, y, m, m, D - m, D - m, 380)) continue;
    const t = (x + y) / (2 * D);
    px(x, y, lerp(74, 122, t), lerp(128, 84, t), lerp(255, 255, t), 255);
  }
}
// 等距立方体
const cx = D / 2, cy = D / 2 + 40;
const s = 300; // 半宽
const h = 190; // 半高（菱形）
const depth = 210; // 立方体高
// 顶点
const top = [cx, cy - h], right = [cx + s, cy], bottom = [cx, cy + h], left = [cx - s, cy];
const topD = [cx, cy - h + depth], rightD = [cx + s, cy + depth], bottomD = [cx, cy + h + depth], leftD = [cx - s, cy + depth];
function inTri(p, a, b, c) {
  const sign = (o, a2, b2) => (a2[0] - o[0]) * (b2[1] - o[1]) - (b2[0] - o[0]) * (a2[1] - o[1]);
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function inQuad(p, a, b, c, d) { return inTri(p, a, b, c) || inTri(p, a, c, d); }
for (let y = 0; y < D; y++) {
  for (let x = 0; x < D; x++) {
    const p = [x, y];
    if (inTri(p, top, right, bottom)) px(x, y, 235, 242, 255, 255);        // 顶面
    else if (inQuad(p, left, bottom, bottomD, leftD)) px(x, y, 92, 116, 240, 255); // 左面
    else if (inQuad(p, bottom, right, rightD, bottomD)) px(x, y, 58, 84, 200, 255); // 右面
  }
}
// 立方体内部网格线（像素风格）
for (let i = 1; i <= 2; i++) {
  const t = i / 3;
  for (let k = 0; k <= 1; k++) {
    const ax = lerp(top[0], k ? bottom[0] : left[0], t) * 0 + lerp(top[0], (k ? bottom : left)[0], t);
    const ay = lerp(top[1], (k ? bottom : left)[1], t);
    const bx = lerp((k ? bottom : left)[0], (k ? right : bottom)[0], t);
    const by = lerp((k ? bottom : left)[1], (k ? right : bottom)[1], t);
    for (let s2 = 0; s2 <= 1; s2 += 0.002) {
      const gx = Math.round(lerp(ax, bx, s2)), gy = Math.round(lerp(ay, by, s2));
      for (let w = 0; w < 8; w++) px(gx + w, gy, 255, 255, 255, 90);
    }
  }
}
// 2x2 降采样到 1024
const out = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  for (let c = 0; c < 4; c++) {
    out[(y * S + x) * 4 + c] = Math.round(
      (buf[(y * 2 * D + x * 2) * 4 + c] + buf[(y * 2 * D + x * 2 + 1) * 4 + c] +
       buf[((y * 2 + 1) * D + x * 2) * 4 + c] + buf[((y * 2 + 1) * D + x * 2 + 1) * 4 + c]) / 4
    );
  }
}
// PNG 编码
function crc32(buf2) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf2.length; i++) c = table[(c ^ buf2[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  out.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const outDir = path.resolve(import.meta.dirname, '..', 'resources', 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon_1024.png'), png);
console.log('icon written:', path.join(outDir, 'icon_1024.png'), png.length, 'bytes');
