// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · ai/aiFallback.js
//  AI 兜底引擎（最后一步）
//  仅当 confidence < 0.8 且前面引擎都失败时调用
//  使用阿里云百炼 API → DeepSeek V4
// ═══════════════════════════════════════════════════════

// 阿里云百炼 API 配置
const API_CONFIG = {
  url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: 'sk-ws-H.RXXRDMI.kAmh.MEUCIQC8UkugPqeYQuFuiMSiEvoLrLlKDnxRiDLfZEURSWDSVQIgJEwPLrTCL_suzChFX0X-ArTKSsThgGthBY3xZm420eg',
  model: 'deepseek-v4',
};

/** 固定的 gCategory 列表 */
const VALID_CATEGORIES = ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '收入', '投资', '其他'];

/**
 * 调用 AI 进行兜底分类
 * @param {string} note - 交易备注
 * @param {string} category - 用户选择的本地类别（老系统）
 * @returns {Promise<{ gCategory: string, gSubCategory: string, tags: string[], confidence: number } | null>}
 */
export async function aiClassify(note, category) {
  if (!note) return null;

  const input = `${note}${category ? ' [' + category + ']' : ''}`;

  const systemPrompt = `你是一个记账分类助手。请根据交易备注对支出进行分类。

规则：
1. gCategory 必须从以下列表中精确选择一个：${VALID_CATEGORIES.join('、')}
2. gSubCategory 是细分描述（如"咖啡"、"打车"、"超市"），不能为空
3. tags 是从备注中提取的关键实体词数组（如["Starbucks", "拿铁"]），最多 5 个
4. confidence 是置信度（0-1），基于分类明确程度

返回纯 JSON（不要 markdown 代码块）：
{"gCategory":"餐饮","gSubCategory":"咖啡","tags":["Starbucks","拿铁"],"confidence":0.9}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(API_CONFIG.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[aiFallback] API 请求失败:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.warn('[aiFallback] API 返回空内容');
      return null;
    }

    // 尝试解析 JSON
    let result;
    try {
      // 清理可能的 markdown 代码块
      const cleaned = content
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      result = JSON.parse(cleaned);
    } catch {
      // 尝试从文本中提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { result = JSON.parse(jsonMatch[0]); } catch { return null; }
      } else {
        return null;
      }
    }

    // 验证 gCategory 是否合法
    if (!VALID_CATEGORIES.includes(result.gCategory)) {
      result.gCategory = '其他';
    }

    // 确保字段存在
    return {
      gCategory: result.gCategory || '其他',
      gSubCategory: result.gSubCategory || '其他',
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 5) : [],
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.7,
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      console.warn('[aiFallback] 请求超时');
    } else {
      console.warn('[aiFallback] 请求异常:', e.message);
    }
    return null;
  }
}

/**
 * AI 调用计数器（用于统计AI使用率）
 */
let _aiCallCount = 0;
let _totalClassifyCount = 0;

export function incrementClassifyCount() {
  _totalClassifyCount++;
}

export function incrementAICallCount() {
  _aiCallCount++;
}

export function getAIStats() {
  return {
    aiCalls: _aiCallCount,
    totalCalls: _totalClassifyCount,
    aiRate: _totalClassifyCount > 0 ? _aiCallCount / _totalClassifyCount : 0,
  };
}
