# Roadster · Personal Finance Copilot

个人财富驾驶舱 — iOS 26 Liquid Glass 设计风格，Firebase 云端同步。

---

## 项目结构 (v2.0)

```
roadster/
├── index.html                # 开发模式入口（引用模块化文件）
├── build.js                  # 构建脚本 → 单文件 dist/roadster.html
├── package.json
├── roadster-icon.svg         # App 图标
├── README.md                 # 本文件
├── docs/
│   └── ARCHITECTURE.md       # 详细架构说明
│
├── src/
│   ├── css/
│   │   ├── tokens.css        # 设计变量（颜色/圆角/阴影/动效曲线）
│   │   ├── layout.css        # 重置 / 导航 / 页面骨架 / 响应式断点
│   │   ├── components.css    # 卡片 / 按钮 / 表单 / 弹窗 / 列表
│   │   ├── charts.css        # 图表容器尺寸 / 发光边框 / 银行卡样式
│   │   └── animations.css    # Toast / 加载动画 / 过渡效果
│   │
│   └── js/
│       ├── config.js         # Firebase 配置 + 常量（类别/调色板）
│       ├── theme.js          # 深浅色切换
│       ├── i18n.js           # 中英文翻译
│       ├── auth.js           # Firebase Auth（登录持久化 + 自动恢复）
│       ├── db.js             # Firestore 云端同步（合并/去重）
│       ├── store.js          # 数据层（localStorage 读写 + 业务逻辑）
│       ├── router.js         # 页面路由 + Toast 通知系统
│       ├── charts.js         # Chart.js 图表构建器
│       ├── utils.js          # 格式化 / 日期解析 / CSV 解析工具
│       ├── main.js           # 应用入口，串联所有模块
│       └── pages/
│           ├── overview.js       # 概览页
│           ├── transactions.js   # 记账明细页（含 CSV 导入导出）
│           ├── assets.js         # 资产管理页
│           └── analysis.js       # 财务分析页
│
└── dist/                     # 构建产物（git-ignored）
    └── roadster.html         # 单文件可直接打开 / 部署
```

---

## 开发模式

直接用任意静态服务器打开 `index.html`（**不能用 `file://` 双击打开**，因为 ES Module + Firebase Auth 需要 HTTP(S) 协议）：

```bash
npx serve . -l 5500
# 或者用 VS Code Live Server 插件
```

浏览器打开 `http://localhost:5500`，模块化文件会按依赖顺序加载，改完代码刷新即可看到效果，无需构建。

---

## 构建单文件版本

```bash
npm install        # 首次运行，安装 esbuild
npm run build       # 生成 dist/roadster.html
```

构建脚本做了两件事：
1. **CSS**：5 个文件按级联顺序拼接成一个 `<style>` 块
2. **JS**：用 esbuild 把所有 ES Module（`import`/`export`）打包成一个文件，Firebase 相关的 import 保持外部引用（由 HTML 里的 `importmap` 在浏览器端解析）

产物 `dist/roadster.html` 是完全自包含的单文件，可以直接双击打开，也可以丢进任何静态托管（GitHub Pages / Vercel / Netlify）。

---

## Firebase 配置

配置已写在 `src/js/config.js` 的 `FIREBASE_CONFIG` 里。如果要换成你自己的项目：

1. 替换 `FIREBASE_CONFIG` 里的 6 个字段
2. Firebase Console → Authentication → Sign-in method → 启用「电子邮件地址/密码」
3. Firebase Console → Firestore Database → 创建数据库 → Rules 粘贴：

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

### 登录持久化说明

v2.0 修复了 v1 的「登录缓存」问题。`auth.js` 在初始化时显式调用：

```js
setPersistence(auth, browserLocalPersistence)
```

这意味着登录态会存进浏览器的 IndexedDB，**刷新页面、关闭标签页、重新打开都不会掉登录**。`onAuthStateChanged` 在页面加载时会自动用持久化的 session 静默恢复，不需要任何手动 token 管理代码 —— `main.js` 第 6 节订阅这个回调即可拿到恢复后的用户。

---

## 数据存储

- **未登录**：数据存在浏览器 `localStorage`，仅本机本浏览器可见
- **已登录**：每次写入会在 2 秒后自动同步到 Firestore（防抖），登录时自动拉取云端数据并与本地合并去重
- **冲突策略**：交易记录按指纹（日期+类型+金额+类别）去重合并；资产以云端为准；历史快照按日期去重，保留最新

---

## v2.0 完成内容

- ✅ 项目结构模块化拆分（CSS×5 / JS×11 + 4 页面）
- ✅ Firebase 登录持久化（`browserLocalPersistence`）
- ✅ 刷新页面自动恢复登录态
- ✅ 单文件构建脚本（esbuild）
- ✅ 本 README + 架构文档

## Roadmap

### v2.1 — Store / Engine 数据层
- 拆分纯数据层（Store）与业务逻辑层（Engine）
- IndexedDB 离线缓存（取代部分 localStorage 用途，支持更大数据量）
- 更细粒度的自动同步策略（按字段增量同步而非整文档覆盖）

### v2.2 — AI 财务分析
- AI 自然语言财务洞察（基于聚合统计调用 LLM，不传原始流水文本）
- 投资统计仪表盘
- FIRE 退休规划计算器
- 预算管理与超支提醒
- 资产走势预测模型升级（替换现有线性回归）

详见 `pages/analysis.js` 文件底部的架构注释。
