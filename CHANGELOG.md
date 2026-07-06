# Roadster 更新日志

## [Unreleased]

### `v2.1.2` — 同步时间优先级修正
- **修复**：同步时间不更新的根因——`_updateSyncStatusRow` 优先读 Firestore 旧值，因 `serverTimestamp()` 写入延迟导致本地 fallback 永不触发；现改为优先读取本地时间戳，Firestore 仅作冷启动兜底

### `v2.1.1` — 同步时间修复 + 头像面板 UI 修复
- **修复**：手动同步后时间不更新（`_updateSyncStatusRow` 仅读 Firestore `getLastSyncDate`，而 v2.1 不再写入该文档；现改为同步成功后向 `users/{uid}/data/finance` 写入 `updatedAt`，并 fallback 至本地 `getLastSyncTime()`）
- **修复**：头像面板登录态仍显示邮箱输入框（`renderLoggedInSection` 遗漏隐藏 `.field:has(#authEmail)`）

---

## 2026-07-06

### `v2.1.0` — Delta Sync 架构重构 (`9989543`)
- **同步架构**：从全量覆盖改为增量同步（Delta Sync）
- **Firestore 结构**：每条交易/资产独立 Document，不再单文档覆盖
- **新增 sync 模块**：`SyncManager` / `MergeEngine` / `UploadQueue` / `DownloadQueue` / `ConflictResolver` / `VersionManager`
- **合并策略**：Last Write Wins，登录后下载→Diff→Merge→上传新增
- **软删除**：`deleted=true`，不物理删除
- **未登录模式**：数据仅本地，不连 Firestore
- **退出登录**：保留本地数据，不清空
- **自动迁移**：旧数据首次启动补充同步元数据

### `v2.0.3` — 类目管理 + 数据清洗 (`8546630`)
- 新增类目管理功能：可新增/删除自定义类目，自动匹配 emoji
- 数据清洗：1293 条记录中 1272 条异常类目自动归类
- 系统 13 个核心类目不可删除

### `v2.0.2` — 时间编辑预填修复 (`adf1a99`)
- 点击 Time Pill 编辑时间时，预填原有日期时间
- 兼容纯日期、缺秒、完整三种格式

### `v2.0.1` — 日历视图 + 时间编辑 (`c21466b`)
- 记账明细新增日历视图，按月显示每日收支色点
- 点击日期展开当日明细，底部月度汇总
- 列表/日历视图可切换
- 每条交易时间变为可点击 Time Pill，点击弹出日期选择器

---

## 2026-07-05

### UI 重设计第三轮 (`d9e5033` ~ `0dbb60c`)
- 桌面端登录按钮 `data-auth-trigger` 修复
- 版本号可见性修复 + PC 登录全局委托
- 修复双重版本号问题

### `v2.0.0` — 版本号 + GitHub Pages 自动部署 (`5cec175` ~ `8188a6e`)
- 添加版本号 `v2026.07.05`
- GitHub Actions 自动构建部署到 drroadster.github.io
- SSH 免密推送配置

---

## 2026-07-02

### 项目初始化 (`90b36ee`)
- 初始项目搭建
- 基础 HTML + JS + CSS 架构
- 记账、资产管理核心功能
