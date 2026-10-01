// 日志：写文件 + 控制台，方便排查问题
const fs = require('fs');
const path = require('path');
const { dirs } = require('./paths');
const { sanitize } = require('./sanitize');

const LOG = () => path.join(dirs().logs, 'app.log');
function line(level, args) {
  let text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try { text = sanitize(text); } catch { /* 脱敏失败时放弃该条内容 */ text = '[日志脱敏失败，内容已丢弃]'; }
  const out = `[${new Date().toISOString()}] [${level}] ${text}`;
  console[out.includes('ERROR') ? 'error' : 'log'](out);
  try { fs.appendFileSync(LOG(), out + '\n'); } catch { /* 忽略 */ }
}
module.exports = {
  info: (...a) => line('INFO', a),
  warn: (...a) => line('WARN', a),
  error: (...a) => line('ERROR', a),
};
