// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · ai/merchantEngine.js
//  商户精确匹配引擎（最高优先级）
//  精确匹配 note 中的商户名，返回 gCategory
// ═══════════════════════════════════════════════════════

/**
 * 商户字典：商户名（小写）→ gCategory
 * 按优先级排序，先匹配到的生效
 */
const MERCHANT_DICT = [
  // 餐饮
  { keywords: ['starbucks', '星巴克'],                    gCategory: '餐饮' },
  { keywords: ['mcdonald', '麦当劳'],                    gCategory: '餐饮' },
  { keywords: ['kfc', '肯德基'],                         gCategory: '餐饮' },
  { keywords: ['pizza', '必胜客'],                        gCategory: '餐饮' },
  { keywords: ['subway', '赛百味'],                       gCategory: '餐饮' },
  { keywords: ['burger', '汉堡王'],                       gCategory: '餐饮' },
  { keywords: ['taco', '塔可'],                           gCategory: '餐饮' },
  { keywords: ['noodle', '拉面', '面馆'],                gCategory: '餐饮' },
  { keywords: ['sushi', '寿司'],                          gCategory: '餐饮' },
  { keywords: ['hotpot', '海底捞', '火锅'],              gCategory: '餐饮' },

  // 交通
  { keywords: ['uber', '滴滴', 'didi', 'lyft'],          gCategory: '交通' },
  { keywords: ['metro', '地铁', 'subway'],               gCategory: '交通' },
  { keywords: ['bus', '公交'],                            gCategory: '交通' },
  { keywords: ['train', '高铁', '火车'],                  gCategory: '交通' },
  { keywords: ['airline', 'air', '机票', 'flight'],      gCategory: '交通' },
  { keywords: ['taxi', '出租车'],                         gCategory: '交通' },
  { keywords: ['shell', 'sinopec', '中石化', '中石油'],  gCategory: '交通' },
  { keywords: ['parking', '停车'],                        gCategory: '交通' },

  // 购物
  { keywords: ['apple', 'apple store', '苹果'],           gCategory: '购物' },
  { keywords: ['taobao', '淘宝'],                         gCategory: '购物' },
  { keywords: ['jd', 'jd.com', '京东'],                   gCategory: '购物' },
  { keywords: ['pdd', 'pinduoduo', '拼多多'],            gCategory: '购物' },
  { keywords: ['amazon', '亚马逊'],                       gCategory: '购物' },
  { keywords: ['tmall', '天猫'],                          gCategory: '购物' },
  { keywords: ['suning', '苏宁'],                         gCategory: '购物' },
  { keywords: ['dewu', '得物'],                          gCategory: '购物' },
  { keywords: ['xiaohongshu', '小红书'],                 gCategory: '购物' },
  { keywords: ['supermarket', '超市', 'walmart', '沃尔玛', 'carrefour', '家乐福'], gCategory: '购物' },

  // 娱乐
  { keywords: ['netflix', 'netflix'],                     gCategory: '娱乐' },
  { keywords: ['spotify', 'spotify'],                     gCategory: '娱乐' },
  { keywords: ['steam', 'steam'],                         gCategory: '娱乐' },
  { keywords: ['xbox', 'playstation'],                    gCategory: '娱乐' },
  { keywords: ['cinema', '电影院', '电影'],               gCategory: '娱乐' },
  { keywords: ['ktv', 'karaoke'],                         gCategory: '娱乐' },
  { keywords: ['concert', '演唱会'],                      gCategory: '娱乐' },
  { keywords: ['game', '游戏'],                           gCategory: '娱乐' },

  // 住房
  { keywords: ['rent', '房租'],                           gCategory: '住房' },
  { keywords: ['mortgage', '房贷'],                       gCategory: '住房' },
  { keywords: ['property', '物业'],                       gCategory: '住房' },
  { keywords: ['electric', '电费'],                       gCategory: '住房' },
  { keywords: ['water', '水费'],                          gCategory: '住房' },
  { keywords: ['gas', '燃气'],                            gCategory: '住房' },
  { keywords: ['internet', '宽带', '网费'],               gCategory: '住房' },

  // 医疗
  { keywords: ['hospital', '医院'],                       gCategory: '医疗' },
  { keywords: ['clinic', '诊所'],                         gCategory: '医疗' },
  { keywords: ['pharmacy', '药店', '药'],                 gCategory: '医疗' },
  { keywords: ['doctor', '医生'],                         gCategory: '医疗' },
  { keywords: ['insurance', '保险'],                       gCategory: '医疗' },

  // 教育
  { keywords: ['tuition', '学费'],                        gCategory: '教育' },
  { keywords: ['book', '书籍', '图书'],                   gCategory: '教育' },
  { keywords: ['course', '课程'],                         gCategory: '教育' },
  { keywords: ['udemy', 'coursera', 'edx'],              gCategory: '教育' },
  { keywords: ['school', '学校'],                         gCategory: '教育' },

  // 收入
  { keywords: ['salary', '工资', '薪资'],                 gCategory: '收入' },
  { keywords: ['bonus', '奖金'],                          gCategory: '收入' },
  { keywords: ['dividend', '分红'],                       gCategory: '收入' },
  { keywords: ['interest', '利息'],                       gCategory: '收入' },
  { keywords: ['refund', '退款'],                         gCategory: '收入' },
  { keywords: ['gift', '红包', '礼物'],                   gCategory: '收入' },

  // 投资
  { keywords: ['stock', '股票'],                          gCategory: '投资' },
  { keywords: ['fund', '基金'],                          gCategory: '投资' },
  { keywords: ['crypto', 'crypto', 'btc', 'eth'],         gCategory: '投资' },
  { keywords: ['bond', '债券'],                           gCategory: '投资' },
];

/**
 * 从 note 中精确匹配商户名
 * @param {string} note - 交易备注
 * @returns {{ gCategory: string, matchedMerchant: string } | null}
 */
export function matchMerchant(note) {
  if (!note || typeof note !== 'string') return null;

  const lowerNote = note.toLowerCase();

  for (const entry of MERCHANT_DICT) {
    for (const kw of entry.keywords) {
      if (lowerNote.includes(kw.toLowerCase())) {
        return {
          gCategory: entry.gCategory,
          matchedMerchant: kw,
        };
      }
    }
  }

  return null;
}

/**
 * 获取所有支持的商户关键词（用于调试/展示）
 * @returns {string[]}
 */
export function getSupportedMerchants() {
  const set = new Set();
  MERCHANT_DICT.forEach(e => e.keywords.forEach(k => set.add(k)));
  return [...set].sort();
}
