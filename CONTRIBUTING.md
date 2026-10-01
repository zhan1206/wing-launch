# 贡献指南

## 报告 Bug
1. 在「设置 → 高级」导出诊断包（已自动脱敏）
2. 到 GitHub Issues 选「Bug 报告」模板，粘贴诊断包与复现步骤

## 提交功能建议
使用「功能建议」Issue 模板，说明场景与期望效果。

## 提交代码
1. Fork 仓库 → 从 `dev` 创建 `feature/你的功能` 分支
2. 提交信息遵循 Conventional Commits（如 `feat: 支持存档搜索`）
3. 确保 `node --check` 全部通过、测试脚本通过
4. 发起 PR 到 `dev` 分支，通过 CI 后由维护者审查合并

## 首次贡献
从 good first issue 标签的 Issue 开始；环境搭建：安装 Node 20+，`npm install`，`npm start` 即可运行，30 分钟内可完成。
