// 生成测试夹具：资源包 / 光影包 / 存档 / 真实模组 jar / .mrpack 整合包 / 错误文件
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import nbt from 'prismarine-nbt';
import zlib from 'zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'test', 'fixtures');
fs.mkdirSync(DIR, { recursive: true });

const PNG1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// 1) 资源包
{
  const zip = new AdmZip();
  zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 34, description: '测试资源包' } })));
  zip.addFile('assets/minecraft/lang/zh_cn.json', Buffer.from(JSON.stringify({ 'test.key': '测试' })));
  zip.addFile('assets/minecraft/textures/block/stone.png', PNG1x1);
  zip.writeZip(path.join(DIR, 'test-resourcepack.zip'));
  console.log('✓ test-resourcepack.zip');
}
// 2) 光影包
{
  const zip = new AdmZip();
  zip.addFile('shaders/basic.vert', Buffer.from('#version 330\nvoid main(){ gl_Position = vec4(0); }'));
  zip.addFile('shaders/basic.frag', Buffer.from('#version 330\nout vec4 c; void main(){ c = vec4(1); }'));
  zip.addFile('shaders/shaders.properties', Buffer.from(''));
  zip.writeZip(path.join(DIR, 'test-shaderpack.zip'));
  console.log('✓ test-shaderpack.zip');
}
// 3) 存档文件夹
{
  const worldDir = path.join(DIR, '测试存档');
  fs.rmSync(worldDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(worldDir, 'region'), { recursive: true });
  const data = {
    type: 'compound', name: '',
    value: {
      Data: {
        type: 'compound',
        value: {
          LevelName: { type: 'string', value: '测试存档' },
          LastPlayed: { type: 'long', value: BigInt(Date.now()) },
          Version: { type: 'compound', value: { Name: { type: 'string', value: '1.21' }, Id: { type: 'int', value: 3953 } } },
          GameType: { type: 'int', value: 0 },
          hardcore: { type: 'byte', value: 0 },
        },
      },
    },
  };
  const buf = nbt.writeUncompressed ? nbt.writeUncompressed(data) : nbt.writeNBT(data);
  fs.writeFileSync(path.join(worldDir, 'level.dat'), zlib.gzipSync(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)));
  fs.writeFileSync(path.join(worldDir, 'icon.png'), PNG1x1);
  console.log('✓ 测试存档/');
}
// 4/5) 真实小模组（Modrinth）+ .mrpack 整合包
const SEARCH = await (await fetch('https://api.modrinth.com/v2/search?limit=5&query=cloth+config&facets=' + encodeURIComponent(JSON.stringify([['versions:1.21.1'], ['categories:fabric'], ['project_type:mod']])))).json();
const hit = SEARCH.hits?.[0];
if (!hit) throw new Error('Modrinth 搜索失败');
const versions = await (await fetch(`https://api.modrinth.com/v2/project/${hit.project_id}/version?game_versions=%5B%221.21.1%22%5D&loaders=%5B%22fabric%22%5D`)).json();
const v = versions[0];
const file = v.files.find((f) => f.primary) || v.files[0];
console.log('模组:', hit.title, v.version_number, file.filename, file.size, 'bytes');
const modBytes = Buffer.from(await (await fetch(file.url)).arrayBuffer());
fs.writeFileSync(path.join(DIR, 'test-mod.jar'), modBytes);
console.log('✓ test-mod.jar（' + modBytes.length + ' bytes）');

{
  const zip = new AdmZip();
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: '测试整合包',
    summary: 'BlockBox 测试用整合包',
    files: [
      {
        path: 'mods/' + file.filename,
        hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
        env: { client: 'required', server: 'required' },
        downloads: [file.url],
        fileSize: file.size,
      },
    ],
    dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.9' },
  };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
  zip.addFile('overrides/options.txt', Buffer.from('version:4153\n'));
  zip.addFile('overrides/config/test.toml', Buffer.from('a = 1\n'));
  zip.writeZip(path.join(DIR, 'test-modpack.mrpack'));
  console.log('✓ test-modpack.mrpack');
}
// 6) 错误文件
fs.writeFileSync(path.join(DIR, 'not-mc-file.txt'), Buffer.from('这不是我的世界相关文件'.repeat(10)));
console.log('✓ not-mc-file.txt');
console.log('夹具目录:', DIR);
