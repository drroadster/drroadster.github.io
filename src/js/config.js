// ═══════════════════════════════════════════════════════
//  ROADSTER v2.3 · config.js
//  Firebase project config + app-wide constants.
//  All other modules import from here — never repeat these values.
// ═══════════════════════════════════════════════════════

// ── Firebase ──────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCFCnb-K042ZmU-W-CozLCA8PhznNLZ-MA",
  authDomain:        "roadster988.firebaseapp.com",
  projectId:         "roadster988",
  storageBucket:     "roadster988.firebasestorage.app",
  messagingSenderId: "447138926799",
  appId:             "1:447138926799:web:585c60bd99dd53f807a7ba",
  measurementId:     "G-0BML53ZJCJ",
};

// ── Firestore paths (Delta Sync v2.1) ─────────────────
// 旧版单文档路径（保留兼容）
export const userDocPath = (uid) => `users/${uid}/data/finance`;

// 新版独立文档路径
export const COLLECTIONS = {
  /** users/{uid}/transactions */
  transactions: (uid) => `users/${uid}/transactions`,
  /** users/{uid}/assets */
  assets: (uid) => `users/${uid}/assets`,
  /** users/{uid}/settings */
  settings: (uid) => `users/${uid}/settings`,
  /** Firestore doc/collection 构造辅助 */
  userDoc: (uid, collection, itemId) => `users/${uid}/${collection}/${itemId}`,
};

// ── Sync configuration ────────────────────────────────
export const SYNC = {
  maxRetries: 3,           // 上传失败最大重试次数
  retryDelayMs: 2000,      // 重试基础延迟（ms），实际使用指数退避
  autoSyncInterval: 30000, // 后台自动同步间隔（30 秒）
};

// ── localStorage keys ─────────────────────────────────
export const LS = {
  TX:           'rdstr_tx',
  ASSETS:       'rdstr_assets',
  ASSET_HISTORY:'rdstr_asset_history',
  THEME:        'rdstr_theme',
  LANG:         'rdstr_lang',
  CUSTOM_CATS:  'rdstr_custom_cats',
  MIGRATED_V2:  'rdstr_migrated_v2',
  MIGRATED_V23: 'rdstr_migrated_v23',
  DRAFTS:       'rdstr_drafts',
};

// ── Chart.js palette ──────────────────────────────────
export const PALETTE = [
  '#5e7ce2','#34c759','#ff9500','#ff3b30',
  '#af52de','#5ac8fa','#ff2d55','#30b0c7',
  '#ffd60a','#32ade6','#30d158','#bf5af2',
];

// ── Built-in expense categories ───────────────────────
export const EXPENSE_CATS = [
  { v:'Food',    icon:'🍜', label:'Food 餐饮' },
  { v:'Shop',    icon:'🛍️', label:'Shop 购物' },
  { v:'Parents', icon:'👨‍👩‍👧', label:'Parents 父母' },
  { v:'Car',     icon:'🚗', label:'Car 交通' },
  { v:'Health',  icon:'🏥', label:'Health 健康' },
  { v:'Home',    icon:'🏠', label:'Home 居家' },
  { v:'Fun',     icon:'🎮', label:'Fun 娱乐' },
  { v:'Travel',  icon:'✈️', label:'Travel 旅行' },
];

// ── Built-in income categories ────────────────────────
export const INCOME_CATS = [
  { v:'Wage',  icon:'💼', label:'Wage 工资' },
  { v:'兼职',  icon:'🖥️', label:'兼职' },
  { v:'红包',  icon:'🧧', label:'红包' },
  { v:'理财',  icon:'📈', label:'理财（可为负）' },
];

// ── All canonical category values ─────────────────────
export const ALL_CATS = [
  ...EXPENSE_CATS.map(c => c.v),
  ...INCOME_CATS.map(c => c.v),
  '其他',
];

// ── Category → icon map ───────────────────────────────
export const CAT_ICONS = {
  Food:'🍜', Shop:'🛍️', Parents:'👨‍👩‍👧', Car:'🚗',
  Health:'🏥', Home:'🏠', Fun:'🎮', Travel:'✈️',
  Wage:'💼', '兼职':'🖥️', '红包':'🧧', '理财':'📈', '其他':'📌',
  // Legacy / common aliases
  '餐饮':'🍜', '购物':'🛍️', '交通':'🚗', '娱乐':'🎮',
  '医疗':'🏥', '教育':'📖', '工资':'💼', '投资':'📈',
  Food_legacy:'☕', Groceries:'🍜',
};

// ── Asset category → gradient map ─────────────────────
export const ASSET_GRADIENTS = {
  '现金/储蓄': 'linear-gradient(135deg,#2563eb 0%,#1e40af 55%,#172554 100%)',
  '基金/股票': 'linear-gradient(135deg,#059669 0%,#047857 55%,#064e3b 100%)',
  '房产':      'linear-gradient(135deg,#d97706 0%,#b45309 55%,#78350f 100%)',
  '车辆':      'linear-gradient(135deg,#475569 0%,#334155 55%,#1e293b 100%)',
  '加密货币':  'linear-gradient(135deg,#f59e0b 0%,#ea580c 55%,#7c2d12 100%)',
  '固定资产':  'linear-gradient(135deg,#7c3aed 0%,#6d28d9 55%,#4c1d95 100%)',
  '其他投资':  'linear-gradient(135deg,#db2777 0%,#be185d 55%,#831843 100%)',
};
export const ASSET_GRADIENT_DEFAULT = 'linear-gradient(135deg,#64748b 0%,#475569 55%,#1e293b 100%)';

// ── Asset category → icon ─────────────────────────────
export const ASSET_ICONS = {
  '现金/储蓄':'🏦', '基金/股票':'📈', '房产':'🏠',
  '车辆':'🚗', '加密货币':'₿', '固定资产':'🏗️', '其他投资':'💼',
};

// ── Category keyword mapping (for smart normalisation) ─
export const CAT_KEYWORD_MAP = [
  { canon:'Food',    kw:/food|meal|eat|餐|饭|菜|吃|饿|午餐|晚餐|早餐|外卖|咖啡|coffee|drink|饮料|奶茶|小吃|零食|泡|面|肉|鱼|蔬|果|食物|饮食|groceries|grocery|supermarket|便利|零|糕|糖|饼|粮|牛奶|milk|snack|lunch|dinner|breakfast/i },
  { canon:'Shop',    kw:/shop|shopping|购物|买|超市|商场|mall|淘宝|京东|拼多多|服装|衣|鞋|包|美妆|化妆|amazon/i },
  { canon:'Parents', kw:/parent|家人|父母|妈|爸|老人|家庭|亲戚|孝顺|子女|孩|儿|女儿/i },
  { canon:'Car',     kw:/car|vehicle|汽车|车|油|加油|停车|地铁|公交|交通|出行|滴滴|uber|taxi|骑行|单车|共享/i },
  { canon:'Health',  kw:/health|医|药|病|诊|检|体检|牙|眼|护|养生|健身|运动|gym/i },
  { canon:'Home',    kw:/home|house|房|租|水电|物业|宽带|网费|煤气|燃气|家居|装修|家具|家电|清洁|电话|话费|通讯|telecom|phone|mobile|手机/i },
  { canon:'Fun',     kw:/fun|entertain|娱乐|游戏|game|电影|影|音乐|ktv|演出|票|玩|书|读|课|教育|学习/i },
  { canon:'Travel',  kw:/travel|旅游|旅行|酒店|hotel|机票|flight|火车|高铁|景区|出境|境外/i },
  { canon:'Wage',    kw:/wage|salary|工资|薪|月薪|年薪|奖金|bonus|绩效/i },
  { canon:'兼职',    kw:/兼职|freelance|副业|外包|接单|稿费|讲课/i },
  { canon:'红包',    kw:/红包|gift|礼金|压岁|礼物/i },
  { canon:'理财',    kw:/理财|invest|投资|基金|股票|fund|stock|分红|dividend|利息|interest|crypto|btc|eth/i },
  // Insurance special case — goes under Parents (common usage for family insurance)
  { canon:'Parents', kw:/保险|insurance/i },
];

// ── Dynamic category management ──────────────────────

/** Read custom categories from localStorage. */
export function getCustomCategories() {
  try { return JSON.parse(localStorage.getItem(LS.CUSTOM_CATS) || '[]'); }
  catch { return []; }
}

/** Persist custom categories to localStorage. */
export function saveCustomCategories(cats) {
  try { localStorage.setItem(LS.CUSTOM_CATS, JSON.stringify(cats)); }
  catch {}
}

/** Add a custom category. Returns false if duplicate. */
export function addCustomCategory(v, icon) {
  const cats = getCustomCategories();
  if (cats.find(c => c.v === v)) return false;
  cats.push({ v, icon: icon || guessIcon(v), label: v, custom: true });
  saveCustomCategories(cats);
  return true;
}

/** Remove a custom category by value. Returns false if not found or is built-in. */
export function removeCustomCategory(v) {
  const builtins = new Set(ALL_CATS);
  if (builtins.has(v)) return false;
  const cats = getCustomCategories().filter(c => c.v !== v);
  saveCustomCategories(cats);
  return true;
}

/** Get all categories (built-in + custom) as flat value list. */
export function getAllCategories() {
  const custom = getCustomCategories().map(c => c.v);
  return [...ALL_CATS, ...custom];
}

/** Get the icon for a category (checks custom cats too). */
export function getCatIcon(v) {
  if (CAT_ICONS[v]) return CAT_ICONS[v];
  const custom = getCustomCategories().find(c => c.v === v);
  return custom?.icon || '📌';
}

/** Guess an emoji icon from category name. */
export function guessIcon(name) {
  if (!name) return '📌';
  const map = {
    '咖啡':'☕','奶茶':'🧋','外卖':'🥡','快递':'📦','宠物':'🐱',
    '教育':'📖','学习':'📚','培训':'🎓','保险':'🛡️','医疗':'💊',
    '理发':'💇','美容':'💄','健身':'🏋️','运动':'⚽','旅行':'✈️',
    '酒店':'🏨','电影':'🎬','音乐':'🎵','游戏':'🎮','数码':'📱',
    '话费':'📞','水费':'💧','电费':'⚡','燃气':'🔥','物业':'🏢',
    '买菜':'🥬','水果':'🍎','零食':'🍿','烟酒':'🍺','加油':'⛽',
    '停车':'🅿️','地铁':'🚇','公交':'🚌','打车':'🚕','房租':'🏠',
    '房贷':'🏡','装修':'🔨','家电':'📺','家具':'🪑','日用品':'🧴',
    '服装':'👔','鞋帽':'👟','礼物':'🎁','捐款':'💝','红包':'🧧',
    '工资':'💰','奖金':'🏆','兼职':'💻','理财':'📈','退税':'📋',
    '公积金':'🏦','社保':'📋','报销':'📝','退款':'💵',
  };
  const lower = name.toLowerCase();
  for (const [kw, icon] of Object.entries(map)) {
    if (lower.includes(kw)) return icon;
  }
  return '📌';
}

// ── App version ───────────────────────────────────────
export const APP_VERSION = '2.3.0';
