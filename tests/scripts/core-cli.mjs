// U.2 解耦验证：无 UI 环境下用核心模块生成一次完整的启动参数（不启动游戏）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const instances = require('../main/instances/instances.js');
const launch = require('../main/instances/launch.js');
const cmd = process.argv[2] || 'help';
if (cmd === 'list') {
  console.log(JSON.stringify(instances.list(), null, 2));
} else if (cmd === 'launch-args') {
  const id = process.argv[3];
  const inst = instances.get(id);
  const meta = await (require('../main/meta/versions.js')).getMergedMeta(inst.launchVersionId || inst.versionId);
  const java = await (require('../main/java/java-manager.js')).ensure(meta.javaVersion?.majorVersion || 21);
  const files = await (require('../main/instances/game-install.js')).ensureVersionFiles(meta, { taskId: 'cli', needAssets: false, onProgress: () => {} });
  const accounts = require('../main/accounts/accounts.js');
  const acc = accounts.current();
  const { jvm, game } = launch.buildLaunchArgs({ meta, account: acc, instance: { settings: inst.settings, id: inst.id }, instanceDir: inst.dir, nativesDir: files.nativesDir, classpath: files.classpath, logConfigPath: files.logConfigPath, memoryMB: 4096, agentArg: null });
  console.log('JAVA:', path.join(java.path, 'bin', 'java'));
  console.log('JVM:', jvm.join(' '));
  console.log('MAIN:', meta.mainClass);
  console.log('GAME:', game.join(' ').slice(0, 300), '…');
  console.log('✅ 核心模块在无 UI 环境下完成启动参数生成');
} else {
  console.log('用法: node tests/scripts/core-cli.mjs [list | launch-args <实例id>]（无 UI 调用核心逻辑）');
}
import path from 'path';
process.exit(0);
