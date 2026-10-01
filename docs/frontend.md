# 前端开发规范（渲染层）

## 架构
- 纯原生 ES Module，无框架、无构建步骤。页面文件位于 `renderer/js/pages/<id>.mjs`。
- 主进程访问一律通过 `api.<ns>.<method>(payload)`（见 `docs/ipc.md` 的完整 API 契约）。部分后台路由可能尚未实现，会抛错「该功能的后台正在接通中」——UI 必须优雅降级（显示可读的失败状态），不许白屏。
- 事件订阅：`import { on } from '../api.js'`，`on('bb:download-progress', (d)=>{})`，返回值为取消订阅函数。
- 本地文件图片用 `bbimg://<绝对路径>` 作为 URL（例如 `bbimg:///Users/x/bg.jpg`，路径需 encodeURIComponent）。

## 页面模块契约
```js
// renderer/js/pages/foo.mjs
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, progressBar, setBreadcrumb, escapeHtml } from '../ui.js';

export default {
  id: 'foo',                    // 唯一 id
  title: '页面名',               // 导航/面包屑标题
  icon: '📦',                   // 导航图标（emoji）
  routes: ['/foo'],             // 该页处理的 hash 前缀；子路径 #/foo/123 会进入 params=['123']
  order: 3,                     // 导航排序
  noPad: false,                 // true 时内容区无内边距（如控制台页）
  hiddenNav: false,             // 不出现在导航栏
  home: 'both',                 // 'classic'|'immersive'|'both'：该页在哪种布局的导航中出现
  async render(el, ctx) {       // ctx: { path, settings, params }
    setBreadcrumb([{ label: '主页', onClick(){location.hash='/'} }, { label: '页面名' }]);
    el.innerHTML = `<div class="page-loading"><div class="spinner"></div><div>加载中…</div></div>`;
    // …渲染。每次 hash 变化都会重新调用 render，请自行清理事件（保存 off 函数并在重渲染前调用）
  },
};
```
一个文件可导出数组（多个页面对象）。路由匹配取最长前缀，`/instances/:id/mods` 这类页面把 routes 设为 `['/instances/']` 再解析 ctx.params。

## 已有能力（勿重复造轮子）
- `ui.js`：`toast(text, 'ok'|'warn'|'error'|'info', ms=3000)`、`confirmDialog(title, msg, {danger,okLabel,cancelLabel})`、`showDialog({title, body(html), actions, wide, onMount(mask, close)})`、`emptyState({icon,title,text,actionsHtml})`、`skeletonRows(n)`、`progressBar(p,{thin,indeterminate})`、`setBreadcrumb([...])`、`escapeHtml`、`dragPaths(e)`（drop 事件 → 本地路径数组）。
- CSS 设计系统见 `styles/base.css`：`.btn(.primary/.danger/.ghost/.sm/.lg/.block)`、`.input`、`.switch`、`.slider`、`.card(.hoverable)`、`.grid.cols-N/.auto`、`.row/.col/.spacer`、`.badge(.accent/.ok/.warn/.err)`、`.tabs .tab`、`.progress`、`.skeleton`、`.list-row`、`.empty-state`、`.console .lv-info/.lv-warn/.lv-error`、`.muted/.small/.tiny/.bold/.ellipsis/.mt-N/.mb-N`。tooltip：给元素加 `data-tip="提示文字"`。
- 3D：`renderer/vendor/three.module.js`（three r169）可直接 `import`。

## 硬性规则（违反=返工）
1. 全部界面文案为自然简体中文；按钮/提示要像人话。错误信息必须解释「发生了什么、可能原因、下一步」，不得直接展示英文报错。
2. 每个页面 render 第一步调用 `setBreadcrumb`；加载用骨架屏/spinner；不许白屏、不许无限转圈无文案。
3. 所有操作有 toast 反馈；删除/覆盖前必须 `confirmDialog`（说明后果）；主进程 API 调用必须 try/catch 并显示中文错误 + 重试按钮。
4. 拖拽：页面内的拖入区域自己监听 dragover/drop（`e.preventDefault()`、用 `dragPaths(e)` 拿路径），并把全局 `#drop-overlay` 的文案通过 `setDropText`（从 main.mjs 导入 `import { setDropText } from '../main.mjs'`）改成「松手后将安装到 XXX 的 YYY」。
5. 空状态必须给引导文案和行动按钮（如「去创建第一个实例」）。
6. 只修改分配给你的文件；不要运行 Electron 应用；完成后对每个文件跑 `node --check 文件.mjs` 确认语法。
7. 代码里不写注释抒情，只在必要处写中文短注释。

## 事件通道（主进程 → 渲染层）
`bb:settings-changed`(设置对象) `bb:accounts-changed` `bb:instances-changed` `bb:download-progress {id,name,type,state,received,total,speed,etaText,error}` `bb:downloads-changed` `bb:install-progress {taskId,stage,text,received,total}` `bb:launch-progress {session,stage,text,percent}` `bb:launch-exit {session,instanceId,code,signal,startedAt,lifetimeMs,crashed}` `bb:server-console {id,lines:[{text,level}]}` `bb:server-status {id,status,port}` `bb:p2p-status {state,reason}` `bb:p2p-players [..]` `bb:lan-worlds [..]` `bb:translate-progress {taskId,done,total,stage,failedCount}` `bb:toast`
