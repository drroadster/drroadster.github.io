# Roadster 更新日志

## [Unreleased]

### `v2026070703` — Firestore 删除可靠性增强 + 去重工具
- **修复**：`deleteCloudRecord` 新增 3 次指数退避重试（1s/2s/4s），失败时写入 Firestore 用户元数据 `deletedTxIds` 确保跨设备过滤
- **修复**：`syncOnLogin` 合并读取 localStorage + Firestore 元数据中的已删除 ID，实现跨设备删除同步
- **修复**：`syncOnLogin` 自动修复缺失 origin/syncStatus 的脏记录（补默认值 `cloud`/`synced`）
- **修复**：init 回调添加 `.catch()` 防止未捕获异常导致静默失败
- **新增**：`output/dedup.html` 浏览器端 Firestore 去重工具，扫描并删除「其他」分类重复记录

### `v2.1.6` — 退出登录清除数据 + 自动刷新 UI + 自动入队修复 + Download-First 多端冲突方案
- **修复**：多端冲突 — A 设备删除记录后，B 设备打开旧版本自动上传覆盖云端删除（根因：旧版 sync 先上传再下载）
- **策略**：`manualSync()` 和 `startAutoSync` 改为 Download-First 流程：先下载云端 → merge → 再上传本地变更，确保多端删除/更新优先同步到本地再上传
- **上传时间戳**：uploadQueue 统一使用 `FieldValue.serverTimestamp()` 写入 `updatedAt`，以服务端时间为准避免本地时钟偏差
- **修复**：退出登录后云端数据仍然显示（根因：`syncOnLogout` 仅从 localStorage 重读，但 localStorage 中已是 Merge 后的混合数据，从未被清除）
- **修改**：`syncOnLogout()` 退出时清除 `rdstr_tx` / `rdstr_assets` / `rdstr_asset_history` / `roadster:lastSync` 及 Firestore 离线缓存，再 `reloadFromStorage`
- **修复**：退出后页面不自动刷新（根因：退出分支缺少 render 调用）
- **新增**：退出分支增加 `renderOverview()` / `renderAssets()` / `renderTransactions()` 调用
- **修复**：`startAutoSync()` 缺少 `_enqueuePendingLocal()` 调用，导致登录后新增记录不会自动入队上传（只有手动同步才能触发）
- **新增**：自动同步 30s 轮询中先调用 `_enqueuePendingLocal()` 将本地待同步记录入队，再处理上传

### `v2.1.5` — 退出清除云端 + 同步反馈 (`6360d7e`)
- **新增**：退出登录后自动清除云端合并数据，恢复本地数据（`syncOnLogout` 调用 `store.reloadFromStorage()`）
- **新增**：手动同步完成后告知上传/新增条数（Toast 格式：「上传 X 条，新增 Y 条」）
- **修改**：`manualSync()` 增加下载+合并步骤，返回 `{ uploaded, downloaded }` 统计

### `v2.1.4` — 来源标签失效修复 (`fc36e43`)
- **修复**：1297 条存量交易 `source` 字段为 undefined，分类标签全部消失
- **修改**：`_sourceTagHtml()` 当 `source` 为空时默认显示 ✋手动 标签（`const effectiveSource = source || 'user'`）
- **修复**：CI 部署最后一步失败（GitHub Pages 服务端临时故障），空提交 `fc36e43` 触发重部署

### `v2.1.3` — Firestore 权限 + 同步死循环修复 (`0261066`)
- **修复**：上传队列积压 26+ 条数据全部 Firestore 写入失败（permission-denied），根因为安全规则未覆盖 transactions 和 assets 子集合
- **修复**：上传失败后不调用 `_markUploadedSynced()` 导致死循环——全部失败 → success=0 → 不 markSynced → 下次同步再次入队
- **新增**：`uploadQueue.js` 输出 `err.code` 错误码便于排查
- **新增**：同步按钮 handler 检查 `isSyncing()` 显示「同步进行中」提示
- **新增**：导出 `isSyncing()`, `getQueueSize()` from syncManager
- **修改**：Firestore 安全规则新增 `transactions` 和 `assets` 子集合授权

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
