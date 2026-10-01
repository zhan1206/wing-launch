# BlockBox IPC 契约（主进程 ↔ 渲染进程）

渲染进程通过 `window.bb.*` 调用主进程；主进程通过 `bb:*` 通道向渲染进程广播事件。
所有方法返回 Promise；失败时抛出 `{ message: 中文错误, code?: string }`。

## 0. 通用
- `bb.bootstrap()` → `{ appVersion, platform, arch, dataDir, isFirstRun, locale }`
- `bb.toast({ type:'ok'|'warn'|'error'|'info', text, ms? })` （主进程主动弹）
- `bb.clip.write(text)` / `bb.clip.read()`
- `bb.pick.file({ title, filters:[{name,extensions}] })` → path | null
- `bb.pick.files(opts)` → paths[]
- `bb.pick.dir({ title })` → path | null
- `bb.pick.save({ title, defaultName, filters })` → path | null
- `bb.shell.openPath(path)` / `bb.shell.showInFolder(path)`
- `bb.window.setDraggableRegions()` 不需要（CSS -webkit-app-region）
- `bb.on(channel, cb)` / `bb.invoke(channel, payload)`（内部通用封装，页面一般用语义化 API）

## 1. 设置与主题（模块1）
- `settings.get()` → 完整设置对象（含 theme:{mode,color,background,blur,dim}, homepage:'classic'|'immersive', memory:'auto'|n, downloadSource:'auto'|'official'|'mirror', translate:{apiKey,apiBase,model}…）
- `settings.set(patch)` → 新设置对象；主进程保存并广播 `bb:settings-changed`
- `theme.presets()` → 6 套内置主题数组 `[{id,name,mode,color,background?,blur,dim}]`
- `theme.importFile(path)` → `{ok:true,theme}` 或 `{ok:false,severity:'broken'|'partial',message}`
- `theme.exportTo(path)` → 当前主题导出为 .mctheme
- `theme.processBackground(path)` → `{path,compressed}` 大图压缩
- `theme.setCustomBackground(path|null)`

## 2. 账户（模块2）
- `accounts.list()` → `[{id,type:'offline'|'microsoft'|'yggdrasil',name,displayName,uuid,serverName?,skinUrl?,headUrl?}]`
- `accounts.currentId()` / `accounts.setCurrent(id)`
- `accounts.addOffline(name)` → account
- `accounts.msStart()` → `{deviceId,userCode,verifyUrl,interval}`（设备码开始）
- `accounts.msPoll(deviceId)` → `{status:'pending'}|{status:'done',account}`（轮询）
- `accounts.addYggdrasil({preset:'littleskin'|'elyby'|'custom',serverUrl?,username,password})` → account | 抛错(中文)
- `accounts.remove(id)` / `accounts.setDisplayName(id,name)`
- 广播 `bb:accounts-changed`

## 3. 实例（模块4/5）
- `instances.list()` → `[{id,name,versionId,loader,loaderVersion?,modsCount,lastPlayed,cover?,boundAccountId?,createdAt}]`
- `instances.create({name,versionId,loader:'vanilla'|'forge'|'fabric'|'quilt'|'neoforge',loaderVersion?})` → instance（自动装 Java/库；进度走 `bb:launch-progress` 类事件 `bb:install-progress {taskId,stage,text,received,total}`）
- `instances.detail(id)` → `{mods:[],worlds:[],resourcepacks:[],shaders:[],settings,backstats…,shaderLoader:'iris'|'optifine'|null}`
- `instances.rename(id,name)`（重名自动加后缀，返回实际名）/ `instances.remove(id)`（移入回收站）
- `instances.setCover(id,path)` / `instances.openFolder(id)`
- `instances.getSettings(id)` → {memory,javaOverride?,width,height,fullscreen,jvmArgs}
- `instances.setSettings(id,patch)` → settings
- `instances.setBoundAccount(id,accountId|null)`
- `instances.launch(id,{accountId?})` → `{session}`；进度事件 `bb:launch-progress {session,stage,text,percent}`；退出事件 `bb:launch-exit {session,instanceId,code,signal,startedAt,lifetimeMs}`
- `versions.listAll()` → `[{id,type:'release'|'snapshot',releaseTime}]`（含内置推荐）
- `versions.recommend()` → 推荐列表（最新原版、1.20.1 Forge 等）

## 4. 实例内容
### 模组
- `mods.list(instanceId)` → `[{file,enabled,name,version,loader,deps?,icon?}]`
- `mods.toggle(instanceId,file,enabled)` / `mods.remove(instanceId,files[])`
- `mods.addFiles(instanceId,paths[])` → `{installed:[],failed:[{path,message}]}`
- `mods.scanMissing(instanceId)` → `[{name,reason}]` 缺失前置列表
- `mods.search({query,gameVersion,loader,source:'modrinth'|'curseforge',limit})` → `[{projectId,slug,title,author,downloads,iconUrl,versions,loaders}]`
- `mods.versions({projectId,gameVersion,loader})` → `[{id,name,date,loaders,gameVersions,deps:[{projectId,slug,required}],filename}]`
- `mods.install({instanceId,projectId,versionId})` → `{ok, warnings:[中文兼容提示]}`（自动带前置，进度走下载事件）
### 存档
- `worlds.list(instanceId)` → `[{dir,name,version,lastPlayed,icon?}]`
- `worlds.importFiles(instanceId,paths[])` → `{imported:[],failed:[]}`
- `worlds.export(instanceId,worldDir,destZip)` / `worlds.remove(instanceId,worldDir)`
### 资源包 / 光影
- `packs.list(instanceId,'resourcepacks'|'shaderpacks')` → `[{file,enabled,size}]`
- `packs.addFiles(instanceId,kind,paths[])` / `packs.remove(...)` / `packs.toggle(...)` / `packs.reorder(instanceId,'resourcepacks',orderedFiles[])`
- `shaders.detect(instanceId)` → `{loader:'iris'|'optifine'|null, suggestion?:中文}`
### 备份
- `backups.list(instanceId)` → `[{file,name,time,kind:'full'|'light',size}]`
- `backups.create(instanceId,{name,kind:'full'|'light'})` / `backups.restore(instanceId,file)` / `backups.remove(instanceId,file)`
- 主进程广播 `bb:instances-changed`

## 5. 拖拽导入
- `drop.classify(paths[])` → `[{path,kind:'modpack'|'mod'|'resourcepack'|'shaderpack'|'world'|'instance-zip'|'unknown',detail}]`
- `drop.install(items, {instanceId?,targetTab?})` → 结果（重名提示 `{renamedTo}`）
- `drop.targets()` → 当前可放置的实例标签页描述

## 6. 整合包与服务器（模块5）
- `modpack.inspect(path)` → `{type:'mrpack'|'curseforge',name,version,loader,loaderVersion,mcVersion,modsCount,serverSupported,javaMajor}`
- `modpack.install({path,name?,createServer})` → `{instanceId?,serverId?}`（进度走下载/安装事件）
- `servers.list()` → `[{id,name,dir,versionId,loader,port,status:'stopped'|'running'|'starting',pid?}]`
- `servers.createVanilla({name,versionId})` / `servers.remove(id)` / `servers.openFolder(id)`
- `servers.start(id)` → `{port}`；`servers.stop(id)`；`servers.sendCommand(id,text)`
- `servers.acceptEula(id,true)`
- 广播 `bb:server-console {id,lines:[{text,level}]}`
- 广播 `bb:server-status {id,status,port}`

## 7. 崩溃分析（模块7）
- `crash.analyze(instanceId,{session?})` → report 或 `{empty:true,message}`
  report = `{what,causes:[{title,detail,likelihood}],fixes:[{text,action:{type:'setMemory',value}|{type:'openSettings',tab}|{type:'openFolder'}|null}],reportText,logPath}`
- `crash.applyFix(instanceId,fix)` → 执行一键修复
- `crash.history(instanceId)` → 历史报告列表

## 8. 联机（模块8）
- `net.lanCheck()` → `{ip, subnet, gatewayReachable, ssid?}`
- `net.lanWorlds()` → 当前监听到的局域网世界 `[{host,port,motd}]`；广播 `bb:lan-worlds`
- `p2p.createRoom({hostPort})` → `{code,port}`（本机隧道端口）
- `p2p.joinRoom(code)` → `{hostInfo,localPort}`（本地隧道端口，用户直连 127.0.0.1:port）
- `p2p.players()` → `[{name,role:'host'|'guest',addr}]`；广播 `bb:p2p-players`
- `p2p.leave()` / `p2p.closeRoom()`
- 广播 `bb:p2p-status {state:'signaling'|'connecting'|'connected'|'error',reason?中文}`

## 9. 下载中心（模块10）
- `downloads.list()` → `[{id,name,type,state:'pending'|'downloading'|'paused'|'done'|'error',received,total,speed,etaText,error?中文}]`
- `downloads.pause(id)/resume(id)/retry(id)/cancel(id)/pauseAll()/resumeAll()`
- 广播 `bb:download-progress {id,…}` / `bb:downloads-changed`

## 10. Java 管理（模块9）
- `java.list()` → `[{major,version,path,vendor,source:'system'|'downloaded'}]`
- `java.ensure(major)` → `{path,version}`（无则自动下载，进度走下载事件）
- `java.download(major)` / `java.remove(major)`
- `java.map(mcVersion)` → `{major,reason中文}`

## 11. 资源管理器（模块11）
- `resources.scan()` → `[{path,kind:'mod'|'resourcepack'|'shaderpack'|'world'|'skin',name,size,instanceName?,enabled,referenced,mtime}]`
- `resources.cleanScan()` → 未使用资源列表（同上结构）
- `resources.delete(paths[])`（移入回收站，可撤销）/ `resources.undoDelete()` / `resources.trashList()`
- `resources.moveToInstance(paths[],instanceId,kind)` / `resources.export(paths[],destDir)`

## 12. 皮肤库（模块3）
- `skins.list()` → `[{id,name,source:'local'|'littleskin'|'elyby',model:'classic'|'slim',addedAt,thumbDataUrl?}]`
- `skins.importFile(path)` → 错误时 `{needCrop:true,width,height,previewDataUrl}` 由 UI 询问
- `skins.importCropped(path,cropParams)` → skin
- `skins.search({site:'littleskin'|'elyby',query})` → `[{id,name,thumbUrl}]`
- `skins.downloadOnline({site,skinId,name})` → skin
- `skins.applyToAccount({skinId,accountId,model})` → 离线账户写入本地皮肤包/第三方走 API；微软正版仅本地预览
- `skins.export(skinId,destPath)` / `skins.remove(skinId)`

## 13. 工具集（模块12）
- 渐变文字：纯渲染进程实现，无需 IPC
- `seedmap.map({seed,mcVersion,cx,cz,scale})` → `{biomes:Int16Array-like, size}`
- `seedmap.structures({seed,mcVersion,x0,z0,x1,z1})` → `[{type,x,z}]`
- `seedmap.nearest({seed,mcVersion,type,x,z,count})` → `[{type,x,z}]`
- `schematic.open(path)` → `{name,width,height,length,blockCount,format}`
- `schematic.load(path)` → `{blocks:Uint16Array,pallete:[names],size:{x,y,z},metadata}`（分块由渲染层处理）
- `schematic.replace(path,{from,to}) → newTempPath` / `schematic.exportSchematic(data,destPath)`
- `translate.start({jarPath,instanceId})` → `{taskId,total}`；`translate.pause(taskId)`/`resume`；广播 `bb:translate-progress {taskId,done,total,stage,failedCount}`
- `recipe.exportDatapack({name,packFormat,recipes:[{type,name,…grid…}],destDir})` → zip 路径
- `recipe.importDatapack(path)` → `[{type,name,…}]`

## 14. 界面辅助
- `ui.screenshot()` → PNG dataURL（自检/测试用）
- `ui.windowControl(action:'close'|'min'|'max')`
- 广播 `bb:first-run-done`
