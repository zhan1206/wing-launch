// 文本脱敏：日志、崩溃报告、诊断包输出前统一过滤敏感信息
const secrets = require('./secrets');

function maskSecretValues(text) {
  let out = text;
  // 已知密钥值替换（取密钥库中的真实值做精确匹配）
  try {
    if (secrets.available()) {
      for (const v of Object.values(secrets.__all ? secrets.__all() : {})) {
        if (v && v.length >= 8 && out.includes(v)) out = out.split(v).join('【已脱敏】');
      }
    }
  } catch { /* 忽略 */ }
  return out;
}
function sanitize(text) {
  if (!text) return text;
  let out = String(text);
  out = maskSecretValues(out);
  out = out
    .replace(/(accessToken|refresh_token|refreshToken|access_token)["\s:=]+[A-Za-z0-9._\-+/=]{10,}/gi, '$1【已脱敏】')
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{10,}/gi, 'Bearer 【已脱敏】')
    .replace(/(apiKey|api_key|apikey)["\s:=]+[A-Za-z0-9._\-+/=]{8,}/gi, '$1【已脱敏】')
    .replace(/sk-[A-Za-z0-9]{10,}/g, '【已脱敏】')
    .replace(/device_code["\s:=]+[A-Za-z0-9._\-+/=]{10,}/gi, 'device_code【已脱敏】')
    // 完整用户路径脱敏（保留盘符结构与文件名前后缀）
    .replace(/\/Users\/[^/\s"']+/g, '/Users/••••')
    // 疑似超长令牌串
    .replace(/[A-Za-z0-9+/_-]{64,}/g, (m) => (m.includes('.') || m.includes('/') ? '【已脱敏】' : m));
  return out;
}
// 脱敏后用户主目录展示用
function prettyPath(p) { return String(p || '').replace(/^\/Users\/[^/]+/, '~'); }

module.exports = { sanitize, prettyPath };
