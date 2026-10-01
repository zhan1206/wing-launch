// 帮助中心：新手任务 / 常见问题 / 术语词典 / 一键诊断 / 错误说明索引
// 主页面处理 #/help；子路由页处理 #/help/<topic>（network、account 等锚点跳转）
import { api, bare } from '../api.js';
import { toast, showDialog, emptyState, skeletonRows, setBreadcrumb, escapeHtml } from '../ui.js';

/* ================= 静态内容 ================= */

const TASKS = [
  {
    id: 'add-account', icon: '👤', title: '添加账户',
    desc: '10 秒搞定，先有一个能进游戏的身份',
    steps: [
      '打开「账户」页面，点右上角「添加账户」。',
      '单机玩选「离线账户」，输入游戏昵称即可创建。',
      '有正版就选「微软正版」，按提示在浏览器完成登录。',
      '建好后点「设为当前账户」，启动游戏时默认使用它。',
    ],
  },
  {
    id: 'create-instance', icon: '🗂️', title: '创建实例',
    desc: '一个实例 = 一套独立的游戏版本和内容',
    steps: [
      '打开「实例」页面，点「新建实例」。',
      '选一个游戏版本（不确定就选最新的正式版）。',
      '需要模组就同时选 Forge / Fabric 等加载器。',
      '点「创建」，启动器会自动下载游戏文件并装好 Java。',
      '完成后点「启动」就能进游戏了。',
    ],
  },
  {
    id: 'install-mods', icon: '🧩', title: '安装模组',
    desc: '在线搜索一键装，或直接把 .jar 拖进窗口',
    steps: [
      '进入一个实例的「模组」标签页。',
      '点「添加模组」在线搜索（Modrinth / CurseForge），选好点安装。',
      '缺前置模组时启动器会提示并自动补齐。',
      '也可以把模组文件直接拖进启动器窗口。',
      '重启游戏生效；装错可在模组页停用或删除。',
    ],
  },
  {
    id: 'backup-instance', icon: '💾', title: '备份实例',
    desc: '动手折腾前，先留一条后路',
    steps: [
      '进入实例的「备份」标签页。',
      '点「创建备份」，选完整备份（含存档与配置）。',
      '等待进度完成，备份会列在下方并显示占用大小。',
      '出问题时点「恢复」，选备份文件一键还原。',
    ],
  },
  {
    id: 'multiplayer', icon: '🌐', title: '联机开黑',
    desc: '同一 WiFi 直连，跨网络用联机房间',
    steps: [
      '房主先在实例里「对局域网开放」世界。',
      '同一 WiFi：好友打开「联机」页，直接能看到房间并加入。',
      '跨网络：房主在「联机房间」生成邀请码发给好友。',
      '好友输入邀请码加入，用页面给出的地址进游戏即可。',
    ],
  },
  {
    id: 'tools', icon: '🧰', title: '使用工具',
    desc: '渐变文字、种子地图、模组翻译等小工具',
    steps: [
      '打开「工具」页面，挑选想用的工具卡片。',
      '例如「种子地图」：输入种子号即可预览地形与结构。',
      '「模组翻译」可把英文模组界面批量翻译成中文。',
      '结果可以直接导出或复制使用。',
    ],
  },
];

const TASK_TARGETS = {
  'add-account': () => '/accounts',
  'create-instance': () => '/instances',
  'install-mods': () => instanceTargets.mods,
  'backup-instance': () => instanceTargets.backups,
  'multiplayer': () => '/multiplayer',
  'tools': () => '/tools',
};

const FAQS = [
  {
    id: 'startup-slow', q: '游戏启动慢，正常吗？',
    a: '正常。启动时要完成校验文件、准备 Java、加载模组等步骤；模组越多启动越慢，大型整合包首次启动花 1-3 分钟很常见，之后会快一些。如果超过 5 分钟还停在启动画面，先看看实例的「崩溃分析」，或检查是否分配的内存太少。',
  },
  {
    id: 'memory', q: '内存设多大合适？',
    a: '纯原版 2GB 就够；装了模组建议 4GB；大型整合包建议 6-8GB。注意不是越大越好：分太多可能把系统拖卡甚至崩溃，一般别超过电脑物理内存的一半。保持「自动」档位时启动器会按机器配置推荐一个合理值。',
  },
  {
    id: 'offline-account', q: '什么是离线账户？和正版有什么区别？',
    a: '离线账户只在本机记一个游戏昵称，不需要购买与验证，最适合单机和局域网联机。微软正版账户用购买的微软账号登录，可以进入开了正版验证的服务器。皮肤站账户用第三方皮肤站（如 LittleSkin）的账号登录，兼顾皮肤与对应服务器的联机。三者随时可以在账户页切换。',
  },
  {
    id: 'ms-login', q: '为什么正版登录要打开浏览器？',
    a: '微软要求登录必须在微软官方页面完成，启动器只会拿到最终结果，全程接触不到你的密码，这是最安全的方式。如果登录页面打不开，多半是网络问题，稍后重试或切换网络即可。',
  },
  {
    id: 'mod-no-effect', q: '模组装了没效果？',
    a: '依次检查这几点：① 模组要装在「这个实例」的模组文件夹里，每个实例互相独立；② 模组版本要匹配游戏版本和加载器，Forge 模组放进 Fabric 实例是不会生效的；③ 是否缺前置模组，实例的模组页会标出缺失的前置；④ 改动之后要完全退出并重启游戏才生效。',
  },
  {
    id: 'crash', q: '游戏崩溃了怎么办？',
    a: '先别慌。打开对应实例的「崩溃分析」，启动器会把日志翻译成人话，常见原因（内存不足、模组冲突、Java 版本不对）都有一键修复按钮。反复崩溃时可以临时停用最近新装的模组试试；解决不了就「导出诊断包」发给懂的朋友或社区求助。',
  },
  {
    id: 'multiplayer-req', q: '联机开黑需要什么条件？',
    a: '同一 WiFi / 校园网：房主「对局域网开放」，好友在联机页就能直接看到并加入。不在同一网络：用「联机房间」，房主生成邀请码、好友输入即可，双方能正常上网就行——不需要公网 IP，也不用设置端口映射。',
  },
  {
    id: 'download-fail', q: '下载失败怎么办？',
    a: '多数是网络波动或官方源连接不畅，启动器会自动切换到国内镜像重试。反复失败时：① 到「设置 → 下载」把下载源手动切换为「国内镜像」；② 检查是否开了代理或防火墙拦截；③ 到「下载中心」对失败的任务点「重试」。已下载完成的内容不受影响。',
  },
  {
    id: 'skin', q: '皮肤怎么换？',
    a: '打开「皮肤库」：可以导入本地皮肤文件，或在皮肤站（LittleSkin / ElyBy）在线搜索后下载，然后「应用到当前账户」。离线账户通过本地皮肤包生效；皮肤站账户会直接同步；微软正版账户因官方限制仅能在启动器内本地预览。',
  },
  {
    id: 'data-where', q: '我的数据存在哪里？',
    a: '账户、实例、存档、下载缓存等全部数据都集中放在启动器的「数据文件夹」里，备份这个文件夹就等于备份一切；卸载启动器程序本身不会删除它。',
    extra: '<div class="mt-2"><button class="btn sm" data-action="open-data-dir">📂 打开数据文件夹</button></div>',
  },
];

const GLOSSARY = [
  { id: 'java', term: 'Java', def: '运行 Minecraft 本体所必需的环境，不同游戏版本需要不同大版本的 Java，启动器会按需自动准备。' },
  { id: 'forge', term: 'Forge', def: '老牌模组加载器，绝大多数经典模组都为它开发，想用这些模组就要先装 Forge。' },
  { id: 'fabric', term: 'Fabric', def: '轻量快速的模组加载器，新版本游戏上的模组更新快，常与 Iris 光影加载器搭配使用。' },
  { id: 'quilt', term: 'Quilt', def: '兼容 Fabric 模组的模组加载器，可以理解为 Fabric 的社区分支增强版。' },
  { id: 'neoforge', term: 'NeoForge', def: '从 Forge 社区分叉出来的新模组加载器，在新版本 Minecraft 上更新更活跃。' },
  { id: 'shaders', term: '光影（Shaders）', def: '让游戏出现真实光影、水面反射等效果的画质增强包，本身不能独立运行。' },
  { id: 'shaderloader', term: '光影加载器（Iris / OptiFine）', def: '负责运行光影的组件：Iris 是 Fabric 上的现代选择，OptiFine 是自带优化与光影的老牌一体化方案。' },
  { id: 'resourcepack', term: '资源包（Resource Pack）', def: '只改外观不改玩法的包装素材：方块贴图、音效、字体、界面样式都由它负责。' },
  { id: 'mod', term: '模组（Mod）', def: '给游戏增加新内容的扩展文件（.jar），例如新生物、新方块、新机器、新玩法。' },
  { id: 'dep', term: '前置模组（Dependency）', def: '某些模组运行前必须先装好的基础库模组，缺了它游戏会启动失败或直接报错。' },
  { id: 'modpack', term: '整合包（Modpack）', def: '把游戏版本、模组、配置、光影预先搭配好的一键安装包，导入后即装即玩。' },
  { id: 'skinstation', term: '皮肤站', def: '第三方皮肤验证服务（如 LittleSkin、ElyBy），用它发放的账号登录就能加载自定义皮肤与披风。' },
  { id: 'yggdrasil', term: 'Yggdrasil', def: '皮肤站使用的账户验证接口协议，皮肤站通过它校验账号并发放皮肤信息。' },
  { id: 'world', term: '存档（World / Save）', def: '某个世界的全部进度数据，存放在实例的 saves 文件夹里，可以备份、导入或分享给朋友。' },
  { id: 'datapack', term: '数据包（Data Pack）', def: '放进存档里的官方玩法扩展，不需要装任何加载器，可修改进度、配方、战利品表等。' },
  { id: 'litematica', term: '投影（Litematica）', def: '一个著名的投影类模组，可以把建筑蓝图以线框形式投射到世界里，对照着逐块搭建。' },
];

const ERRORS = [
  {
    id: 'disk', name: '磁盘空间不足',
    desc: '下载或备份到一半失败，提示磁盘没有空间。到「资源管理器」清理不再使用的模组、光影和旧备份，腾出至少 2GB 再继续。',
    target: '/resources', actionLabel: '去清理 →',
  },
  {
    id: 'login', name: '登录过期 / 登录失效',
    desc: '提示账户凭据无效或需要重新登录。正版账户的令牌有有效期，到账户页重新登录一次即可；皮肤站账户密码改过也需要重新登录。',
    target: '/accounts', actionLabel: '去重新登录 →',
  },
  {
    id: 'port', name: '端口被占用（25565）',
    desc: '开服务器或联机时提示端口冲突。启动器会自动改用 25566 等备用端口，一般不用手动处理；好友进服时注意连接地址里的端口要和页面显示的一致。',
  },
  {
    id: 'java', name: 'Java 版本不匹配',
    desc: '启动时报 UnsupportedClassVersionError 或类似错误，通常是新版本游戏用了旧 Java。到「Java 管理」安装对应版本的 Java（1.20.5 以上需要 Java 21），启动器一般也会自动处理。',
    target: '/settings/java', actionLabel: '去 Java 管理 →',
  },
  {
    id: 'network', name: '无法连接版本服务器 / 下载超时',
    desc: '在线登录、版本列表或下载全部失败。启动器会自动尝试国内镜像；如果仍不行，检查网络与代理设置，详见下方常见问题里的「下载失败怎么办」。',
    target: '/help/network', actionLabel: '查看网络帮助 →',
  },
  {
    id: 'deps', name: '缺少前置模组',
    desc: '启动报错提示某个模组缺失（Missing mods ...）。到实例的「模组」页查看「缺失前置」列表并补齐，或用在线安装让启动器自动带上前置。',
    target: '/instances', actionLabel: '去模组页 →',
  },
  {
    id: 'permission', name: '文件被占用 / 没有读写权限',
    desc: 'macOS 上常见于数据文件夹被安全软件锁定或权限被改动。确认文件夹没有设为只读，必要时在「系统设置 → 隐私与安全性」里放行启动器。',
  },
];

const TABS = [
  { id: 'tasks', label: '🧭 新手任务' },
  { id: 'faq', label: '💬 常见问题' },
  { id: 'glossary', label: '📖 术语词典' },
  { id: 'diag', label: '🩺 一键诊断' },
];

// 子路由锚点：topic → 要定位的条目（按优先级）
const TOPIC_ANCHORS = {
  network: [
    { tab: 'faq', id: 'faq-download-fail' },
    { tab: 'errors', id: 'err-network' },
    { tab: 'faq', id: 'faq-multiplayer-req' },
  ],
  account: [
    { tab: 'faq', id: 'faq-offline-account' },
    { tab: 'faq', id: 'faq-ms-login' },
    { tab: 'errors', id: 'err-login' },
  ],
};
const TOPIC_LABELS = { network: '网络', account: '账户' };

/* ================= 页面状态 ================= */

let curTab = 'tasks';
let query = '';
let checkState = {};        // taskChecklist 副本
let diagState = 'idle';     // idle | running | done | error
let diagResult = null;
let diagError = null;
let dataDir = null;
const instanceTargets = { mods: '/instances', backups: '/instances' };

/* ================= 工具函数 ================= */

function matchText(q, ...texts) {
  return texts.some((t) => String(t || '').toLowerCase().includes(q));
}

function taskDone(id) { return !!(checkState && checkState[id]); }

/* ================= 区块渲染 ================= */

function tasksHtml(list) {
  if (!list.length) return '';
  return `<div class="grid cols-2">${list.map((t) => {
    const done = taskDone(t.id);
    return `<div class="card" id="task-card-${t.id}">
      <div class="row">
        <span style="font-size:24px">${t.icon}</span>
        <div class="col" style="gap:2px;flex:1;min-width:0">
          <span class="bold">${t.title}</span>
          <span class="tiny muted">${t.desc}</span>
        </div>
        <label class="switch" data-tip="标记完成"><input type="checkbox" data-task="${t.id}" ${done ? 'checked' : ''}><span class="track"></span></label>
      </div>
      <ol class="small muted mt-2" style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
        ${t.steps.map((s) => `<li>${s}</li>`).join('')}
      </ol>
      <div class="row mt-3">
        <span class="badge ${done ? 'ok' : ''}" data-task-badge>${done ? '已完成' : '未完成'}</span>
        <span class="spacer"></span>
        <button class="btn sm primary" data-action="goto-task" data-task="${t.id}">去完成 →</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function faqHtml(list, expandAll) {
  if (!list.length) return '';
  return `<div class="col">${list.map((f) => `
    <details class="card" id="faq-${f.id}" ${expandAll ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:600">💬 ${f.q}</summary>
      <div class="small muted mt-2" style="line-height:1.75">${f.a}${f.extra || ''}</div>
    </details>`).join('')}</div>`;
}

function glossaryHtml(list) {
  if (!list.length) return '';
  return `<div class="grid cols-2">${list.map((g) => `
    <div class="card" id="term-${g.id}" style="padding:12px 16px">
      <div class="bold">${g.term}</div>
      <div class="small muted mt-1">${g.def}</div>
    </div>`).join('')}</div>`;
}

function errorsHtml(list) {
  if (!list.length) return '';
  return `<div class="col">${list.map((e) => `
    <div class="card" id="err-${e.id}" style="padding:12px 16px">
      <div class="row">
        <span class="bold">🚨 ${e.name}</span>
        <span class="spacer"></span>
        ${e.target ? `<button class="btn sm" data-action="goto" data-target="${e.target}">${e.actionLabel || '去看看'}</button>` : ''}
      </div>
      <div class="small muted mt-1">${e.desc}</div>
    </div>`).join('')}</div>`;
}

function sectionHtml(title, inner, count) {
  return `<div class="section-title">${title}<span class="badge">${count} 条</span></div>${inner}`;
}

/* ================= 诊断视图 ================= */

function diagSummaryBadges(checks) {
  const ok = checks.filter((c) => c.state === 'ok').length;
  const fail = checks.filter((c) => c.state === 'fail').length;
  const unk = checks.filter((c) => c.state !== 'ok' && c.state !== 'fail').length;
  return `<div class="row wrap">
    ${ok ? `<span class="badge ok">✅ ${ok} 项正常</span>` : ''}
    ${fail ? `<span class="badge err">❌ ${fail} 项异常</span>` : ''}
    ${unk ? `<span class="badge warn">⚠️ ${unk} 项无法检查</span>` : ''}
  </div>`;
}

function diagView() {
  if (diagState === 'running') {
    return `<div class="row mb-3"><div class="spinner sm"></div><span class="small muted">正在逐项检查 Java、网络、磁盘、权限等，大约需要几秒钟…</span></div>${skeletonRows(6)}`;
  }
  if (diagState === 'error') {
    const msg = String((diagError && diagError.message) || diagError || '未知错误');
    return emptyState({
      icon: '😵', title: '诊断没能完成',
      text: '运行诊断时出现问题：' + msg + '。可能是后台服务暂时不可用，稍等片刻再试一次。',
      actionsHtml: '<button class="btn primary" data-action="run-diag">重试诊断</button>',
    });
  }
  if (diagState === 'done' && diagResult && Array.isArray(diagResult.checks)) {
    const checks = diagResult.checks;
    const icons = { ok: '✅', fail: '❌', unknown: '⚠️' };
    const borders = { ok: 'var(--ok)', fail: 'var(--err)', unknown: 'var(--warn)' };
    return `
      <div class="row wrap mb-3">
        ${diagSummaryBadges(checks)}
        <span class="spacer"></span>
        <button class="btn" data-action="run-diag">重新诊断</button>
        <button class="btn primary" data-action="export-diag">📤 导出诊断包</button>
      </div>
      <div class="col">${checks.map((c, i) => `
        <div class="card" style="border-left:4px solid ${borders[c.state] || 'var(--border-2)'};padding:12px 16px">
          <div class="row">
            <span style="font-size:20px">${icons[c.state] || '⚠️'}</span>
            <div class="col" style="gap:2px;flex:1;min-width:0">
              <span class="bold">${escapeHtml(c.name)}</span>
              <span class="small muted">${escapeHtml(c.detail || '')}</span>
            </div>
            ${c.state !== 'ok' && c.fix ? `<button class="btn sm" data-diag-fix="${i}">怎么解决</button>` : ''}
          </div>
        </div>`).join('')}</div>
      <div class="tiny muted-3 mt-3">检查结果只用于本机排查；「导出诊断包」生成的文件已自动脱敏，可以放心分享。</div>`;
  }
  return `<div class="card center" style="padding:36px 20px">
    <div style="font-size:42px">🩺</div>
    <div class="bold mt-2" style="font-size:16px">一键诊断</div>
    <div class="small muted mt-2" style="max-width:520px;margin:8px auto 0">检查 Java、网络、磁盘空间、文件权限、联机端口、账户与实例完整性等关键项，快速找出启动器出问题的原因，并给出对应的解决办法。</div>
    <div class="mt-3"><button class="btn primary lg" data-action="run-diag">🔍 开始诊断</button></div>
  </div>`;
}

/* ================= 主体渲染 ================= */

function tabView(tab) {
  if (tab === 'tasks') return sectionHtml('🧭 新手任务', tasksHtml(TASKS), TASKS.length);
  if (tab === 'faq') return sectionHtml('💬 常见问题', faqHtml(FAQS, false), FAQS.length);
  if (tab === 'glossary') return sectionHtml('📖 术语词典', glossaryHtml(GLOSSARY), GLOSSARY.length);
  if (tab === 'errors') return sectionHtml('🚨 错误说明', errorsHtml(ERRORS), ERRORS.length);
  if (tab === 'diag') return diagView();
  return '';
}

function searchView(q) {
  const tasks = TASKS.filter((t) => matchText(q, t.title, t.desc, t.steps.join(' ')));
  const faqs = FAQS.filter((f) => matchText(q, f.q, f.a));
  const terms = GLOSSARY.filter((g) => matchText(q, g.term, g.def));
  const errs = ERRORS.filter((e) => matchText(q, e.name, e.desc));
  const total = tasks.length + faqs.length + terms.length + errs.length;
  if (!total) {
    return emptyState({
      icon: '🔍', title: '没有找到与「' + query.trim() + '」相关的条目',
      text: '换个更短的关键词试试，例如「内存」「联机」「崩溃」。',
    });
  }
  let html = '';
  if (tasks.length) html += sectionHtml('🧭 新手任务', tasksHtml(tasks), tasks.length);
  if (faqs.length) html += sectionHtml('💬 常见问题', faqHtml(faqs, true), faqs.length);
  if (terms.length) html += sectionHtml('📖 术语词典', glossaryHtml(terms), terms.length);
  if (errs.length) html += sectionHtml('🚨 错误说明', errorsHtml(errs), errs.length);
  return html;
}

function paintTabs() {
  const bar = document.getElementById('help-tabs');
  if (!bar) return;
  bar.innerHTML = TABS.map((t) =>
    `<button class="tab ${!query && curTab === t.id ? 'active' : ''}" data-help-tab="${t.id}">${t.label}</button>`
  ).join('');
}

function paintBody() {
  const body = document.getElementById('help-body');
  if (!body) return;
  const q = query.trim().toLowerCase();
  body.innerHTML = q ? searchView(q) : tabView(curTab);
}

/* ================= 交互动作 ================= */

async function runDiag() {
  diagState = 'running';
  diagResult = null;
  diagError = null;
  paintBody();
  try {
    diagResult = await api.diagnostics.run();
    diagState = 'done';
  } catch (e) {
    diagError = e;
    diagState = 'error';
  }
  paintBody();
}

async function applyDiagFix(idx) {
  const check = diagResult && diagResult.checks && diagResult.checks[idx];
  if (!check || !check.fix) return;
  const btn = document.querySelector(`[data-diag-fix="${idx}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
  try {
    const r = await api.fixes.apply({ fix: check.fix });
    toast(r && r.message ? r.message : '修复已执行，请按页面提示继续。', 'ok', 5000);
  } catch (e) {
    toast('修复执行失败：' + String((e && e.message) || e) + '。可以按条目里的说明手动处理。', 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '怎么解决'; }
  }
}

async function exportDiag() {
  const btn = document.querySelector('[data-action="export-diag"]');
  if (btn) { btn.disabled = true; btn.textContent = '正在生成…'; }
  try {
    const r = await api.diagnostics.export();
    showDiagDialog(r || {});
  } catch (e) {
    toast('导出诊断包失败：' + String((e && e.message) || e) + '。可以稍后再试。', 'error', 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📤 导出诊断包'; }
  }
}

function showDiagDialog({ summary, text }) {
  const s = summary || {};
  const checks = Array.isArray(s.checks) ? s.checks : [];
  const sys = s.system || {};
  const timeText = s.time ? new Date(s.time).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN');
  showDialog({
    title: '诊断包已生成',
    wide: true,
    body: `
      <p class="small">生成时间：${escapeHtml(timeText)}　环境：${escapeHtml([sys.os, sys.arch].filter(Boolean).join(' · ') || '未知')}</p>
      <div class="mt-2">${diagSummaryBadges(checks)}</div>
      <p class="small muted mt-2">包含 ${escapeHtml(String(checks.length))} 项检查结果${Array.isArray(s.instances) ? '、' + escapeHtml(String(s.instances.length)) + ' 个实例概要' : ''}和最近的运行日志。</p>
      <div class="card mt-3" style="background:var(--card-2);padding:10px 14px">
        <div class="small">🔒 诊断包已自动脱敏，不含令牌与 API Key，可放心分享。</div>
      </div>
      <div class="row mt-3">
        <button class="btn primary" id="diag-copy">📋 复制到剪贴板</button>
        <span class="tiny muted">复制后粘贴到聊天窗口即可求助</span>
      </div>`,
    actions: [{ label: '关闭', value: true, primary: true }],
    onMount(mask) {
      const copyBtn = mask.querySelector('#diag-copy');
      if (copyBtn) copyBtn.onclick = async () => {
        try {
          await api.clip.write({ text: String(text || JSON.stringify(s, null, 2)) });
          toast('诊断包内容已复制到剪贴板，可以粘贴分享了。', 'ok');
        } catch (e) {
          toast('复制失败：' + String((e && e.message) || e) + '。可以手动截屏这份摘要。', 'error', 5000);
        }
      };
    },
  });
}

async function openDataDir() {
  if (!dataDir) {
    try { const b = await bare('bootstrap')(); dataDir = (b && b.dataDir) || null; } catch { dataDir = null; }
  }
  if (!dataDir) {
    toast('暂时拿不到数据文件夹的位置。可以到「设置 → 高级」里查看数据目录。', 'warn', 5000);
    return;
  }
  try {
    await api.shell.openPath(dataDir);
    toast('已打开数据文件夹。', 'ok', 2000);
  } catch (e) {
    toast('打开数据文件夹失败：' + String((e && e.message) || e), 'error', 5000);
  }
}

async function toggleTask(input) {
  const id = input.dataset.task;
  const checked = input.checked;
  const prev = checkState[id];
  checkState = { ...checkState, [id]: checked };
  toast(checked ? '已标记为完成，继续加油！' : '已恢复为未完成。', 'ok', 1500);
  const card = document.getElementById('task-card-' + id);
  if (card) {
    const badge = card.querySelector('[data-task-badge]');
    if (badge) { badge.className = 'badge ' + (checked ? 'ok' : ''); badge.textContent = checked ? '已完成' : '未完成'; }
  }
  try {
    await api.settings.set({ taskChecklist: { ...checkState } });
  } catch (e) {
    checkState = { ...checkState, [id]: prev };
    input.checked = !!prev;
    const card2 = document.getElementById('task-card-' + id);
    if (card2) {
      const badge = card2.querySelector('[data-task-badge]');
      if (badge) { badge.className = 'badge ' + (prev ? 'ok' : ''); badge.textContent = prev ? '已完成' : '未完成'; }
    }
    toast('保存完成状态失败：' + String((e && e.message) || e) + '。请稍后重试。', 'error', 5000);
  }
}

/* ================= 主题锚点 ================= */

function applyTopic(el, topic) {
  const anchors = TOPIC_ANCHORS[topic];
  const body = document.getElementById('help-body');
  if (!body) return;
  let notice;
  if (anchors && anchors.length) {
    curTab = anchors[0].tab;
    query = '';
    const label = TOPIC_LABELS[topic] || topic;
    notice = `<div class="card mb-3" style="border-left:4px solid var(--accent)"><div class="row">🎯 <span class="small">已为你定位到与「${escapeHtml(label)}」相关的条目，下面高亮显示。</span></div></div>`;
  } else {
    notice = `<div class="card mb-3" style="border-left:4px solid var(--warn)"><div class="row">💡 <span class="small">帮助中心暂时没有「${escapeHtml(topic)}」主题的专属条目，先看看全部内容吧。</span></div></div>`;
  }
  paintTabs();
  paintBody();
  body.insertAdjacentHTML('afterbegin', notice);
  setTimeout(() => {
    for (const a of anchors || []) {
      const node = document.getElementById(a.id);
      if (!node) continue;
      if (node.tagName === 'DETAILS') node.open = true;
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent)';
      setTimeout(() => { node.style.boxShadow = ''; }, 3200);
      break;
    }
  }, 160);
}

/* ================= 页面对象 ================= */

async function renderHelp(el, ctx, topic) {
  setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '帮助' }]);
  checkState = (ctx && ctx.settings && ctx.settings.taskChecklist) || {};
  query = '';
  diagState = 'idle';
  diagResult = null;
  diagError = null;

  // 后台准备：数据目录位置 + 实例跳转目标（失败不影响页面）
  bare('bootstrap')().then((b) => { dataDir = (b && b.dataDir) || dataDir; }).catch(() => { });
  api.instances.list().then((list) => {
    if (Array.isArray(list) && list.length && list[0] && list[0].id) {
      const id = encodeURIComponent(list[0].id);
      instanceTargets.mods = '/instances/' + id + '/mods';
      instanceTargets.backups = '/instances/' + id + '/backups';
    }
  }).catch(() => { });

  el.innerHTML = `
    <div class="row mb-3">
      <input class="input" id="help-search" type="search" placeholder="搜索问题、术语或错误，例如「内存」「联机」…" style="max-width:420px">
    </div>
    <div class="tabs" id="help-tabs"></div>
    <div id="help-body"></div>`;

  const body = el.querySelector('#help-body');
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action],[data-diag-fix]');
    if (!t) return;
    if (t.dataset.action === 'goto') location.hash = t.dataset.target;
    else if (t.dataset.action === 'goto-task') location.hash = (TASK_TARGETS[t.dataset.task] && TASK_TARGETS[t.dataset.task]()) || '/';
    else if (t.dataset.action === 'open-data-dir') openDataDir();
    else if (t.dataset.action === 'run-diag') runDiag();
    else if (t.dataset.action === 'export-diag') exportDiag();
    else if (t.dataset.diagFix != null) applyDiagFix(Number(t.dataset.diagFix));
  });
  body.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-task]');
    if (input) toggleTask(input);
  });

  const search = el.querySelector('#help-search');
  search.addEventListener('input', () => { query = search.value; paintTabs(); paintBody(); });
  search.focus();

  paintTabs();
  paintBody();
  if (topic) applyTopic(el, topic);
}

const helpPage = {
  id: 'help',
  title: '帮助',
  icon: '❓',
  routes: ['/help'],
  order: 10,
  home: 'both',
  async render(el, ctx) {
    await renderHelp(el, ctx, null);
  },
};

const helpTopicPage = {
  id: 'help-topic',
  title: '帮助',
  icon: '❓',
  routes: ['/help/'],
  hiddenNav: true,
  async render(el, ctx) {
    let topic = '';
    try { topic = decodeURIComponent((ctx.params || [])[0] || ''); } catch { topic = String((ctx.params || [])[0] || ''); }
    await renderHelp(el, ctx, topic || null);
  },
};

export default [helpPage, helpTopicPage];
