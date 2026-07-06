// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · ai/scoringEngine.js
//  评分系统（模糊匹配）
//  关键词加权评分，选择最高分 gCategory
// ═══════════════════════════════════════════════════════

/**
 * 关键词→(gCategory, 权重) 映射
 * 权重：-10 ~ +10，正数越大越可能属于该分类
 */
const SCORE_MAP = [
  // 餐饮 (food)
  { kw: 'coffee',   cat: '餐饮', score: 5 },
  { kw: '咖啡',     cat: '餐饮', score: 5 },
  { kw: 'meal',     cat: '餐饮', score: 4 },
  { kw: 'food',     cat: '餐饮', score: 4 },
  { kw: 'restaurant',cat:'餐饮', score: 4 },
  { kw: '饭',       cat: '餐饮', score: 3 },
  { kw: '菜',       cat: '餐饮', score: 3 },
  { kw: '吃',       cat: '餐饮', score: 3 },
  { kw: 'drink',    cat: '餐饮', score: 3 },
  { kw: '奶茶',     cat: '餐饮', score: 4 },
  { kw: '外卖',     cat: '餐饮', score: 4 },
  { kw: '火锅',     cat: '餐饮', score: 5 },
  { kw: '小吃',     cat: '餐饮', score: 3 },
  { kw: '零食',     cat: '餐饮', score: 3 },
  { kw: 'lunch',    cat: '餐饮', score: 5 },
  { kw: 'dinner',   cat: '餐饮', score: 5 },
  { kw: 'breakfast',cat: '餐饮', score: 5 },
  { kw: 'grocery',  cat: '餐饮', score: 3 },
  { kw: '超市',     cat: '餐饮', score: 2 },

  // 交通
  { kw: 'taxi',     cat: '交通', score: 5 },
  { kw: '打车',     cat: '交通', score: 5 },
  { kw: 'uber',     cat: '交通', score: 5 },
  { kw: '滴滴',     cat: '交通', score: 5 },
  { kw: '地铁',     cat: '交通', score: 5 },
  { kw: 'metro',    cat: '交通', score: 5 },
  { kw: '公交',     cat: '交通', score: 5 },
  { kw: 'bus',      cat: '交通', score: 4 },
  { kw: '高铁',     cat: '交通', score: 4 },
  { kw: 'train',    cat: '交通', score: 4 },
  { kw: 'flight',   cat: '交通', score: 5 },
  { kw: '机票',     cat: '交通', score: 5 },
  { kw: '加油',     cat: '交通', score: 5 },
  { kw: 'gas',      cat: '交通', score: 4 },
  { kw: '停车',     cat: '交通', score: 5 },
  { kw: 'parking',  cat: '交通', score: 5 },

  // 购物
  { kw: 'buy',      cat: '购物', score: 3 },
  { kw: '买',       cat: '购物', score: 3 },
  { kw: 'shop',     cat: '购物', score: 3 },
  { kw: 'shopping', cat: '购物', score: 5 },
  { kw: '购物',     cat: '购物', score: 5 },
  { kw: '淘宝',     cat: '购物', score: 5 },
  { kw: '京东',     cat: '购物', score: 5 },
  { kw: '拼多多',   cat: '购物', score: 5 },
  { kw: 'amazon',   cat: '购物', score: 5 },
  { kw: '衣服',     cat: '购物', score: 4 },
  { kw: '服装',     cat: '购物', score: 4 },
  { kw: '鞋',       cat: '购物', score: 3 },
  { kw: '电子',     cat: '购物', score: 3 },
  { kw: '数码',     cat: '购物', score: 3 },
  { kw: '手机',     cat: '购物', score: 4 },
  { kw: '电脑',     cat: '购物', score: 4 },

  // 住房
  { kw: 'rent',     cat: '住房', score: 5 },
  { kw: '房租',     cat: '住房', score: 5 },
  { kw: '房贷',     cat: '住房', score: 5 },
  { kw: 'mortgage', cat: '住房', score: 5 },
  { kw: '水电',     cat: '住房', score: 4 },
  { kw: '物业',     cat: '住房', score: 4 },
  { kw: '电费',     cat: '住房', score: 5 },
  { kw: '水费',     cat: '住房', score: 5 },
  { kw: '燃气',     cat: '住房', score: 5 },
  { kw: '宽带',     cat: '住房', score: 4 },
  { kw: '网费',     cat: '住房', score: 4 },
  { kw: '话费',     cat: '住房', score: 3 },
  { kw: 'home',     cat: '住房', score: 3 },
  { kw: 'house',    cat: '住房', score: 3 },

  // 娱乐
  { kw: 'movie',    cat: '娱乐', score: 5 },
  { kw: '电影',     cat: '娱乐', score: 5 },
  { kw: 'game',     cat: '娱乐', score: 4 },
  { kw: '游戏',     cat: '娱乐', score: 4 },
  { kw: '英雄',     cat: '娱乐', score: 3 },
  { kw: '联盟',     cat: '娱乐', score: 3 },
  { kw: '点卡',     cat: '娱乐', score: 4 },
  { kw: 'steam',    cat: '娱乐', score: 5 },
  { kw: '王者',     cat: '娱乐', score: 3 },
  { kw: '原神',     cat: '娱乐', score: 3 },
  { kw: 'switch',   cat: '娱乐', score: 4 },
  { kw: 'ps5',      cat: '娱乐', score: 4 },
  { kw: 'xbox',     cat: '娱乐', score: 4 },
  { kw: 'ktv',      cat: '娱乐', score: 5 },
  { kw: 'music',    cat: '娱乐', score: 3 },
  { kw: '音乐',     cat: '娱乐', score: 3 },
  { kw: 'concert',  cat: '娱乐', score: 5 },
  { kw: '演唱会',   cat: '娱乐', score: 5 },
  { kw: '旅游',     cat: '娱乐', score: 3 },
  { kw: 'travel',   cat: '娱乐', score: 3 },
  { kw: '酒店',     cat: '娱乐', score: 4 },
  { kw: 'hotel',    cat: '娱乐', score: 4 },
  { kw: '健身',     cat: '娱乐', score: 3 },
  { kw: 'gym',      cat: '娱乐', score: 3 },

  // 医疗
  { kw: 'hospital', cat: '医疗', score: 5 },
  { kw: '医院',     cat: '医疗', score: 5 },
  { kw: 'doctor',   cat: '医疗', score: 4 },
  { kw: '医生',     cat: '医疗', score: 4 },
  { kw: '药',       cat: '医疗', score: 4 },
  { kw: '看病',     cat: '医疗', score: 4 },
  { kw: '体检',     cat: '医疗', score: 5 },
  { kw: '诊所',     cat: '医疗', score: 4 },
  { kw: 'health',   cat: '医疗', score: 3 },
  { kw: 'medical',  cat: '医疗', score: 3 },

  // 教育
  { kw: '学费',     cat: '教育', score: 5 },
  { kw: 'tuition',  cat: '教育', score: 5 },
  { kw: '课程',     cat: '教育', score: 4 },
  { kw: 'course',   cat: '教育', score: 4 },
  { kw: '培训',     cat: '教育', score: 4 },
  { kw: '书',       cat: '教育', score: 3 },
  { kw: 'book',     cat: '教育', score: 3 },
  { kw: 'learn',    cat: '教育', score: 3 },
  { kw: '教育',     cat: '教育', score: 3 },
  { kw: 'education',cat: '教育', score: 3 },

  // 收入
  { kw: 'wage',     cat: '收入', score: 5 },
  { kw: 'salary',   cat: '收入', score: 5 },
  { kw: '工资',     cat: '收入', score: 5 },
  { kw: 'bonus',    cat: '收入', score: 5 },
  { kw: '奖金',     cat: '收入', score: 5 },
  { kw: '兼职',     cat: '收入', score: 4 },
  { kw: '红包',     cat: '收入', score: 5 },
  { kw: 'refund',   cat: '收入', score: 4 },
  { kw: '退款',     cat: '收入', score: 4 },
  { kw: 'income',   cat: '收入', score: 3 },
  { kw: '理财',     cat: '收入', score: 2 },
  { kw: '利息',     cat: '收入', score: 4 },

  // 投资
  { kw: 'stock',    cat: '投资', score: 5 },
  { kw: '股票',     cat: '投资', score: 5 },
  { kw: 'fund',     cat: '投资', score: 5 },
  { kw: '基金',     cat: '投资', score: 5 },
  { kw: 'investment',cat:'投资', score: 5 },
  { kw: '投资',     cat: '投资', score: 5 },
  { kw: '分红',     cat: '投资', score: 5 },
  { kw: 'dividend', cat: '投资', score: 5 },
  { kw: 'crypto',   cat: '投资', score: 5 },
  { kw: 'btc',      cat: '投资', score: 5 },
  { kw: 'eth',      cat: '投资', score: 5 },
  { kw: '债券',     cat: '投资', score: 4 },
];

/**
 * 对 note 进行关键词评分
 * @param {string} note
 * @returns {{ gCategory: string, score: number, matches: string[] } | null}
 */
export function score(note) {
  if (!note || typeof note !== 'string') return null;

  const lowerNote = note.toLowerCase();
  const scores = {};
  const matchLog = [];

  for (const { kw, cat, score } of SCORE_MAP) {
    if (lowerNote.includes(kw.toLowerCase())) {
      scores[cat] = (scores[cat] || 0) + score;
      matchLog.push(`${kw}→${cat}(+${score})`);
    }
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) return null;

  // 选择最高分
  entries.sort((a, b) => b[1] - a[1]);

  return {
    gCategory: entries[0][0],
    score: entries[0][1],
    matches: matchLog,
  };
}
