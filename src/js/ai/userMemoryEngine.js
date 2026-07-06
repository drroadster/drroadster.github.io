// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · ai/userMemoryEngine.js
//  用户行为记忆引擎
//  基于 localStorage 存储用户修改历史，持续学习偏好
// ═══════════════════════════════════════════════════════

const STORAGE_KEY = 'rdstr_user_memory';

/**
 * 用户记忆数据结构
 * {
 *   starbucks: { "餐饮": 0.9, "娱乐": 0.1 },
 *   rent:      { "住房": 1.0 },
 *   ...
 * }
 */

/**
 * 加载用户记忆
 * @returns {Record<string, Record<string, number>>}
 */
function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 保存用户记忆
 * @param {Record<string, Record<string, number>>} memory
 */
function _save(memory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (e) {
    console.warn('[userMemoryEngine] 保存失败:', e);
  }
}

/**
 * 归一化关键词（去除无关字符，统一小写）
 * @param {string} key
 * @returns {string}
 */
function _normalizeKey(key) {
  if (!key) return '';
  return key.toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]/g, ' ')  // 保留字母、数字、中文，其余替换为空格
    .replace(/\s+/g, ' ')                   // 合并空格
    .trim()
    .split(' ')
    .filter(w => w.length >= 2)            // 去掉太短的词
    .join(' ');
}

/**
 * 查询用户历史选择
 * @param {string} note
 * @returns {{ gCategory: string, confidence: number } | null}
 */
export function recall(note) {
  if (!note) return null;

  const memory = _load();
  const words = _normalizeKey(note).split(' ');

  let bestCategory = null;
  let bestScore = 0;

  // 聚合所有记忆中匹配的分类权重
  const categoryScores = {};
  for (const word of words) {
    if (!memory[word]) continue;
    for (const [cat, weight] of Object.entries(memory[word])) {
      categoryScores[cat] = (categoryScores[cat] || 0) + weight;
    }
  }

  const entries = Object.entries(categoryScores);
  if (entries.length === 0) return null;

  // 选择最高分的 category
  for (const [cat, score] of entries) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  // 置信度：基于匹配词数和总分
  // 单词语法 >= 0.8 视为高置信
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  const confidence = Math.min(bestScore / Math.max(totalWeight, 1), 1);

  if (confidence < 0.5) return null;

  return {
    gCategory: bestCategory,
    confidence,
  };
}

/**
 * 学习：用户修改了分类，更新记忆权重
 * @param {string} note - 交易备注
 * @param {string} userCategory - 用户选择的 gCategory
 */
export function learn(note, userCategory) {
  if (!note || !userCategory) return;

  const memory = _load();
  const words = _normalizeKey(note).split(' ');

  const LEARN_RATE = 0.3;       // 单次学习权重
  const DECAY_FACTOR = 0.95;    // 其他分类衰减因子

  for (const word of words) {
    if (!word) continue;

    if (!memory[word]) memory[word] = {};

    // 强化用户选择的分类
    memory[word][userCategory] = (memory[word][userCategory] || 0) + LEARN_RATE;

    // 衰减其他分类
    for (const cat of Object.keys(memory[word])) {
      if (cat !== userCategory) {
        memory[word][cat] *= DECAY_FACTOR;
      }
    }

    // 清理极低权重
    if (memory[word][userCategory] > 1) memory[word][userCategory] = 1;
    for (const cat of Object.keys(memory[word])) {
      if (memory[word][cat] < 0.01) delete memory[word][cat];
    }
  }

  _save(memory);
}

/**
 * 获取所有记忆（用于调试或管理）
 * @returns {Record<string, Record<string, number>>}
 */
export function getAllMemories() {
  return _load();
}

/**
 * 清空所有用户记忆
 */
export function clearAllMemories() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
