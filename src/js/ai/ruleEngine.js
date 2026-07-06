// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · ai/ruleEngine.js
//  关键词规则匹配引擎
//  基于多层关键词体系进行规则匹配
// ═══════════════════════════════════════════════════════

/**
 * gCategory → 关键词列表
 * 第一层：主类目→关键词（用于确定 gCategory）
 */
const CATEGORY_RULES = {
  餐饮: [
    '咖啡', '奶茶', '火锅', '外卖', '餐厅', '饭', '菜', '吃', '饿',
    '午餐', '晚餐', '早餐', 'coffee', 'drink', '饮料', '小吃', '零食',
    '泡面', '肉', '鱼', '蔬', '果', '食物', '饮食', 'groceries',
    'grocery', 'supermarket', '便利', '零', '糕', '糖', '饼', '粮',
    '牛奶', 'milk', 'snack', 'lunch', 'dinner', 'breakfast',
    'meal', 'food', 'restaurant', 'cafe', 'bakery', '面包', '甜点',
    '烧烤', '烤肉', '串', '酒', '啤酒', 'bar', 'pub',
  ],
  交通: [
    '打车', '地铁', '高铁', '公交', '交通', '出行', '滴滴', 'uber',
    'taxi', '骑行', '单车', '共享', 'car', 'vehicle', '汽车', '车',
    '油', '加油', '停车', 'train', 'flight', '机票', 'bus', 'metro',
    'toll', '过路', '高速', 'etc', '火车',
  ],
  购物: [
    '淘宝', '京东', '拼多多', '购买', '买', 'shop', 'shopping', '购物',
    '超市', '商场', 'mall', '服装', '衣', '鞋', '包', '美妆', '化妆',
    'amazon', '日用品', '数码', '电子', '手机', '电脑', '家具', '家电',
    'purchase', 'buy', 'store', 'retail',
  ],
  住房: [
    '房租', '房贷', '水电', '物业', 'home', '住房', 'house', 'rent',
    'mortgage', '水费', '电费', '燃气', '煤气', '宽带', '网费',
    '话费', '电话', '装修', '维修', '家居',
  ],
  娱乐: [
    '电影', '游戏', 'ktv', 'fun', '娱乐', 'play', 'movie', 'game',
    'music', 'concert', '演唱会', '演出', '票', '旅游', 'travel',
    '酒店', 'hotel', '景点', '门票', '度假', '健身', 'gym', '运动',
    'sport', 'steam', '英雄', '联盟', '点卡', '王者', '吃鸡', 'pubg',
    'lol', 'dota', '原神', 'switch', 'ps5', 'xbox', 'epic', 'nintendo', '手游',
  ],
  医疗: [
    '医院', '看病', '药', 'health', '医疗', 'medical', 'doctor',
    'hospital', '诊所', '体检', '牙', '眼', '护', '养生',
    '检查', '手术',
  ],
  教育: [
    '学费', '书', '课程', 'education', '教育', 'learn', 'course',
    'book', '培训', '考试', '报名', '学', '课', '教材', '文具',
    'tuition',
  ],
  收入: [
    '工资', '兼职', '红包', '理财', 'wage', 'income', 'salary',
    'bonus', '奖金', '退款', 'refund', '报销', '利息',
    'freelance', '副业', '稿费',
  ],
  投资: [
    '股票', '基金', '投资', 'investment', 'stock', 'fund',
    'dividend', '分红', 'crypto', 'btc', 'eth', '债券', '理财',
  ],
};

/**
 * gCategory → gSubCategory 细分规则
 * 在确定 gCategory 后，进一步细分
 */
const SUBCATEGORY_RULES = {
  餐饮: [
    { keywords: ['咖啡', 'coffee'],                         sub: '咖啡' },
    { keywords: ['奶茶', 'milk tea'],                       sub: '奶茶' },
    { keywords: ['外卖', 'delivery'],                       sub: '外卖' },
    { keywords: ['火锅', 'hotpot'],                         sub: '火锅' },
    { keywords: ['烧烤', '烤肉', '串'],                     sub: '烧烤' },
    { keywords: ['面包', 'bakery', '甜点', '糕', '饼'],     sub: '烘焙' },
    { keywords: ['零食', 'snack', '小吃'],                  sub: '零食' },
    { keywords: ['groceries', 'grocery', 'supermarket', '超市', '便利'], sub: '超市采购' },
    { keywords: ['酒', '啤酒', 'bar', 'pub', '饮料', 'drink'], sub: '饮品' },
    { keywords: ['午餐', 'lunch'],                           sub: '午餐' },
    { keywords: ['晚餐', 'dinner'],                          sub: '晚餐' },
    { keywords: ['早餐', 'breakfast'],                       sub: '早餐' },
  ],
  交通: [
    { keywords: ['打车', '滴滴', 'uber', 'taxi'],           sub: '打车' },
    { keywords: ['地铁', 'metro', 'subway'],                sub: '地铁' },
    { keywords: ['公交', 'bus'],                             sub: '公交' },
    { keywords: ['高铁', 'train', '火车'],                  sub: '火车' },
    { keywords: ['机票', 'flight', '航空'],                 sub: '机票' },
    { keywords: ['加油', 'shell', '油'],                     sub: '加油' },
    { keywords: ['停车', 'parking'],                         sub: '停车' },
    { keywords: ['单车', '骑行', '共享'],                   sub: '共享出行' },
    { keywords: ['高速', 'toll', 'etc', '过路'],            sub: '过路费' },
  ],
  购物: [
    { keywords: ['淘宝', 'taobao'],                          sub: '淘宝' },
    { keywords: ['京东', 'jd'],                              sub: '京东' },
    { keywords: ['拼多多', 'pdd', 'pinduoduo'],             sub: '拼多多' },
    { keywords: ['数码', '电子', '手机', '电脑'],           sub: '数码' },
    { keywords: ['服装', '衣', '鞋', '包'],                 sub: '服饰' },
    { keywords: ['美妆', '化妆'],                           sub: '美妆' },
    { keywords: ['超市', 'supermarket', 'walmart', '日用品'], sub: '超市' },
    { keywords: ['家具', '家电', '家居'],                   sub: '家居' },
  ],
  住房: [
    { keywords: ['房租', 'rent'],                            sub: '房租' },
    { keywords: ['房贷', 'mortgage'],                        sub: '房贷' },
    { keywords: ['水费', 'water'],                           sub: '水费' },
    { keywords: ['电费', 'electric'],                        sub: '电费' },
    { keywords: ['燃气', 'gas', '煤气'],                     sub: '燃气' },
    { keywords: ['宽带', '网费', 'internet'],               sub: '网络' },
    { keywords: ['话费', '电话', 'phone', 'mobile'],         sub: '通讯' },
    { keywords: ['物业', 'property'],                        sub: '物业' },
    { keywords: ['装修', '家居'],                           sub: '装修家居' },
  ],
  娱乐: [
    { keywords: ['电影', 'movie', 'cinema'],                 sub: '电影' },
    { keywords: ['游戏', 'game', 'steam'],                   sub: '游戏' },
    { keywords: ['ktv', 'music', '音乐'],                    sub: '音乐/KTV' },
    { keywords: ['旅游', 'travel', '酒店', 'hotel', '景点'], sub: '旅游' },
    { keywords: ['健身', 'gym', '运动', 'sport'],           sub: '健身' },
  ],
  医疗: [
    { keywords: ['医院', 'hospital'],                        sub: '医院' },
    { keywords: ['药', 'pharmacy', '药店'],                 sub: '药品' },
    { keywords: ['体检', '检查'],                           sub: '体检' },
    { keywords: ['牙', 'dentist'],                           sub: '牙科' },
  ],
  教育: [
    { keywords: ['学费', 'tuition'],                         sub: '学费' },
    { keywords: ['书', 'book'],                              sub: '书籍' },
    { keywords: ['课程', 'course'],                          sub: '课程' },
    { keywords: ['培训'],                                   sub: '培训' },
  ],
  收入: [
    { keywords: ['工资', 'wage', 'salary'],                  sub: '工资' },
    { keywords: ['兼职', 'freelance', '副业'],              sub: '兼职' },
    { keywords: ['红包', 'gift'],                            sub: '红包' },
    { keywords: ['理财', '利息', 'dividend'],               sub: '理财收益' },
    { keywords: ['退款', 'refund'],                          sub: '退款' },
  ],
  投资: [
    { keywords: ['股票', 'stock'],                           sub: '股票' },
    { keywords: ['基金', 'fund'],                            sub: '基金' },
    { keywords: ['crypto', 'btc', 'eth'],                    sub: '加密货币' },
    { keywords: ['债券', 'bond'],                            sub: '债券' },
  ],
};

/**
 * 从 note 匹配 gCategory
 * @param {string} note
 * @returns {{ gCategory: string, gSubCategory: string, matchedKeywords: string[] } | null}
 */
export function matchByRule(note) {
  if (!note || typeof note !== 'string') return null;

  const lowerNote = note.toLowerCase();
  const scores = {};

  // 统计每个 gCategory 命中的关键词数
  for (const [category, keywords] of Object.entries(CATEGORY_RULES)) {
    let count = 0;
    const matched = [];
    for (const kw of keywords) {
      if (lowerNote.includes(kw.toLowerCase())) {
        count++;
        matched.push(kw);
      }
    }
    if (count > 0) {
      scores[category] = { count, matched };
    }
  }

  if (Object.keys(scores).length === 0) return null;

  // 选择命中最多的 gCategory
  const bestCategory = Object.entries(scores).sort((a, b) => b[1].count - a[1].count)[0];

  // 在最佳 gCategory 下匹配 gSubCategory
  let gSubCategory = '其他';
  const subRules = SUBCATEGORY_RULES[bestCategory[0]];
  if (subRules) {
    for (const rule of subRules) {
      for (const kw of rule.keywords) {
        if (lowerNote.includes(kw.toLowerCase())) {
          gSubCategory = rule.sub;
          break;
        }
      }
      if (gSubCategory !== '其他') break;
    }
  }

  return {
    gCategory: bestCategory[0],
    gSubCategory,
    matchedKeywords: bestCategory[1].matched,
  };
}

/**
 * 获取所有 gCategory 列表
 * @returns {string[]}
 */
export function getAllGCategories() {
  return Object.keys(CATEGORY_RULES);
}
