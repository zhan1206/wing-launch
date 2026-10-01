# 更新日志（Keep a Changelog 格式）

## v1.2.0 - 2026-10-01

> ⚠️ **破坏性变更：系统要求从 macOS 12+ 提升到 macOS 13+（Ventura 及以上）。**

### Added
- 「关闭游戏进程」后自动创建**存档快照**（新增 `kind: 'save'`，包含 `saves` 但不含体积庞大的模组/资源包，自动备份保留最近 3 份）

### Changed
- **系统要求提升至 macOS 13+**：Electron 从 33 升级到 44 后 macOS 12 不再被 Chromium 支持
- 依赖升级：`electron` 33.4.11 → **44.5.1**、`@electron/packager` 18.4.4 → **20.3.0**、`adm-zip` 0.5.18 → **0.6.1**；`npm audit` 由 4 个 high 漏洞降为 **0**
- `clipboard` 模块按 Electron 44 的 W3C 对齐改造，读写改为异步
- 项目名称统一为 **Wing Launch**：应用包名、DMG 产物名（`Wing-Launch-<版本>-<架构>.dmg`）、版权声明、User-Agent、界面/文档文案
- CI：`npm install` → `npm ci`，Node 锁定 24（electron 44 与 packager 20 要求 ≥ 22.12.0），语法检查覆盖 `tests/scripts`
- 新增 `package-lock.json`，依赖解析与审计结果可复现

### Fixed
- **应用无法启动/无法打包**：`package.json` 的 `main` 指向不存在的 `main/main.js`，`@electron/packager` 会以 "main entry point was not found" 直接失败；修正为 `src/main/main.js`
- **`build.sh` 无法执行**：第 1 步引用了不存在的 `scripts/make-icon.mjs`（配合 `set -e` 立即退出）；改为 `tests/scripts/make-icon.mjs`，并修正过期的 `--ignore` 路径
- 托盘图标路径少一层目录（`../resources` → `../../resources`），导致托盘图标静默加载失败
- 13 个测试/构建脚本的 `ROOT` 多算一层目录，指向 `tests/` 而非仓库根
- e2e 密钥扫描测试扫描的是 `main`/`renderer`/`scripts` 三个不存在的目录，`readdirSync` 抛错导致该安全检查长期空跑
- 安全：`.mcinstance` 导入未做路径穿越校验，恶意包内条目名（`mods/../../x`）可写到实例目录之外
- 安全：整合包索引中的相对路径被直接用作下载落点（`.mrpack` / CurseForge 共 4 处），可越出目录
- 安全：`zipsafe` 增加单条目上限，堵住「存储型条目绕过膨胀比检查、单条最大可分配数 GB」的内存耗尽路径
- 「关闭游戏进程」提示"已自动创建存档快照"但从未创建快照；现已真正落盘，且定位不到实例或创建失败时会如实提示
- 通知中心每推一条通知就重复插入「关闭游戏进程」按钮并新建一个 8 秒轮询定时器（无幂等、定时器不回收）
- P2P 联机访客的本地 TCP 监听服务器永不关闭（返回的是端口号而非 server 对象，`teardownRoom` 的 `close()` 恒为空操作）
- 本地 API 的 HTTP server 无 `error` 监听，端口被占用时直接崩溃主进程；现改为异步返回中文提示
- 服务端进程 `spawn` 无 `error` 监听，Java 缺失/无执行权限时崩溃并把状态永久卡在 starting
- 下载写流无 `error` 监听可致主进程崩溃；下载完成后用 `readFileSync` 整文件算哈希改为流式计算
- Java 版本自动重试分支的浮空 Promise 会变成 unhandledRejection，重试失败时用户无任何提示
- `sessions` 与 `translateTasks` 两个 Map 只增不减，长期多开/多次翻译内存持续增长（已加延迟回收）
- 清理 37 个一次性调试脚本 `tests/scripts/dbg*.mjs`（含原作者机器的硬编码绝对路径与旧目录布局）

## v1.1.0 - 2026-10-01
### Added
- 智能性能调优（硬件画像/5 预设/一键回滚/性能诊断）
- 模组冲突诊断（依赖图/Mixin 注入/类冲突/更新提醒，均注明依据）
- 帮助中心与一键诊断（脱敏诊断包）
- 无障碍（字号缩放/高对比度/减少动画/色盲友好）
- 服务器设置界面化与备份、启动前检查、离线模式、数据导出导入与分级重置
### Fixed
- 下载器校验错误作用域与重复启动竞态
- 实例/服务器字段保存覆盖丢失
- 解压路径穿越漏洞

## v1.0.0
### Added
- 首个正式版本：账户/实例/模组/整合包/联机/Java 管理/下载中心/皮肤库/工具集/崩溃分析/双主页/引导
