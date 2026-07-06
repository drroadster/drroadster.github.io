// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · ai/categorizer.js
//  主分类器 — 整合所有引擎
//
//  执行流程（优先级从高到低）：
//  1. Merchant Engine     → 商户精确匹配
//  2. Rule Engine         → 关键词规则匹配
//  3. User Memory Engine  → 用户行为记忆
//  4. Scoring Engine      → 关键词加权评分
//  5. Confidence Check     → 置信度 < 0.8?
//  6. AI Fallback          → 仅当需要且前面未命中时
//
//  所有结果必须有 gCategory，tags 必须存在
// ═══════════════════════════════════════════════════════

import { matchMerchant } from './merchantEngine.js';
import { matchByRule } from './ruleEngine.js';
import { recall } from './userMemoryEngine.js';
import { score } from './scoringEngine.js';
import { aiClassify, incrementClassifyCount, incrementAICallCount } from './aiFallback.js';

/**
 * @typedef {Object} ClassifyResult
 * @property {string}  gCategory    - 财务分析主轴（餐饮/交通/购物/住房/娱乐/医疗/教育/收入/投资/其他）
 * @property {string}  gSubCategory - 结构细分
 * @property {string[]} tags        - 完全开放语义层标签
 * @property {number}  confidence   - 置信度 0-1
 * @property {string}  source       - 来源 "merchant" | "rule" | "user" | "ai" | "none"
 * @property {boolean} aiUsed       - 是否调用了 AI
 * @property {boolean} userOverride - 是否用户手动修改过
 * @property {string}  matchedRule  - 匹配的规则描述
 */

/**
 * 对一条交易进行分类
 * @param {string} note       - 交易备注
 * @param {string} category   - 老系统类别（可选，作为辅助）
 * @param {string} type       - 交易类型 '收入' | '支出'
 * @returns {Promise<ClassifyResult>}
 */
export async function categorize(note, category, type) {
  incrementClassifyCount();

  const baseResult = {
    gCategory: '其他',
    gSubCategory: '其他',
    tags: [],
    confidence: 0,
    source: 'none',
    aiUsed: false,
    userOverride: false,
    matchedRule: '',
  };

  // 如果没有 note，直接返回默认值
  if (!note && !category) return baseResult;

  const searchText = note || category || '';

  // ═══════════════════════════════════════════════════
  //  Step 1: Merchant Engine — 商户精确匹配
  // ═══════════════════════════════════════════════════
  const merchantResult = matchMerchant(searchText);
  if (merchantResult) {
    return {
      ...baseResult,
      gCategory: merchantResult.gCategory,
      gSubCategory: merchantResult.matchedMerchant,
      tags: [merchantResult.matchedMerchant],
      confidence: 0.95,
      source: 'merchant',
      matchedRule: `商户匹配: ${merchantResult.matchedMerchant}`,
    };
  }

  // ═══════════════════════════════════════════════════
  //  Step 2: Rule Engine — 关键词规则匹配
  // ═══════════════════════════════════════════════════
  const ruleResult = matchByRule(searchText);
  if (ruleResult) {
    return {
      ...baseResult,
      gCategory: ruleResult.gCategory,
      gSubCategory: ruleResult.gSubCategory,
      tags: ruleResult.matchedKeywords || [],
      confidence: 0.85,
      source: 'rule',
      matchedRule: `关键词匹配: ${(ruleResult.matchedKeywords || []).slice(0, 3).join(', ')}`,
    };
  }

  // ═══════════════════════════════════════════════════
  //  Step 3: User Memory Engine — 用户行为记忆
  // ═══════════════════════════════════════════════════
  const memoryResult = recall(searchText);
  if (memoryResult && memoryResult.confidence >= 0.6) {
    return {
      ...baseResult,
      gCategory: memoryResult.gCategory,
      gSubCategory: '记忆匹配',
      tags: [],
      confidence: memoryResult.confidence,
      source: 'user',
      matchedRule: `历史记忆: ${memoryResult.gCategory}`,
    };
  }

  // ═══════════════════════════════════════════════════
  //  Step 4: Scoring Engine — 关键词加权评分
  // ═══════════════════════════════════════════════════
  const scoreResult = score(searchText);
  if (scoreResult) {
    const scoreConfidence = Math.min(scoreResult.score / 15, 0.85);

    return {
      ...baseResult,
      gCategory: scoreResult.gCategory,
      gSubCategory: '评分匹配',
      tags: [],
      confidence: scoreConfidence,
      source: 'rule',
      matchedRule: `评分: ${scoreResult.gCategory} (${scoreResult.score}分)`,
    };
  }

  // ═══════════════════════════════════════════════════
  //  Step 5: AI Fallback — 最后一搏
  // ═══════════════════════════════════════════════════

  // 5a. AI 优先 —— 让 AI 做最终判断
  const aiResult = await aiClassify(note || category || '', category);
  incrementAICallCount();

  if (aiResult) {
    return {
      ...baseResult,
      gCategory: aiResult.gCategory,
      gSubCategory: aiResult.gSubCategory || 'AI分类',
      tags: aiResult.tags || [],
      confidence: aiResult.confidence || 0.7,
      source: 'ai',
      aiUsed: true,
      matchedRule: 'AI 兜底分类',
    };
  }

  // 5b. AI 失败 → 利用老系统 category 推断（兜底）
  if (category && type) {
    const catInfer = _inferFromCategory(category, type);
    if (catInfer) {
      return {
        ...baseResult,
        gCategory: catInfer.gCategory,
        gSubCategory: category,
        tags: [category],
        confidence: 0.7,
        source: 'rule',
        matchedRule: `从类别推断: ${category}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════
  //  Step 6: 全部失败 → 默认"其他"
  // ═══════════════════════════════════════════════════
  return {
    ...baseResult,
    gCategory: '其他',
    gSubCategory: '未分类',
    tags: [],
    confidence: 0,
    source: 'none',
    matchedRule: '无法分类',
  };
}

/**
 * 从老系统 category 推断 gCategory
 * @param {string} category - 老系统类别（如 Food, Shop, Car 等）
 * @param {string} type - '收入' | '支出'
 * @returns {{ gCategory: string } | null}
 */
function _inferFromCategory(category, type) {
  if (!category) return null;

  const map = {
    // 支出类
    'Food':    { gCategory: '餐饮' },
    'Shop':    { gCategory: '购物' },
    'Parents': { gCategory: '其他' },
    'Car':     { gCategory: '交通' },
    'Health':  { gCategory: '医疗' },
    'Home':    { gCategory: '住房' },
    'Fun':     { gCategory: '娱乐' },
    'Travel':  { gCategory: '娱乐' },
    // 收入类
    'Wage':    { gCategory: '收入' },
    '兼职':    { gCategory: '收入' },
    '红包':    { gCategory: '收入' },
    '理财':    { gCategory: '投资' },
    // 通用
    '其他':    { gCategory: '其他' },
    // Legacy aliases
    '餐饮':    { gCategory: '餐饮' },
    '购物':    { gCategory: '购物' },
    '交通':    { gCategory: '交通' },
    '娱乐':    { gCategory: '娱乐' },
    '医疗':    { gCategory: '医疗' },
    '教育':    { gCategory: '教育' },
    '工资':    { gCategory: '收入' },
    '投资':    { gCategory: '投资' },
  };

  const lower = category.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (key.toLowerCase() === lower) return val;
  }

  // 智能推断：收入相关 → 收入；否则 → 根据 type
  if (type === '收入') return { gCategory: '收入' };
  if (type === '支出') return { gCategory: '其他' };

  return null;
}

export { getAIStats } from './aiFallback.js';
