/**
 * 云雾 / Claude thinking 响应中，最终 JSON 有时只出现在 `message.reasoning_content` 内
 *（`message.content` 为空或仅换行）。本模块从长 reasoning 文本中尽力抠出可解析的 JSON 串，
 * 供 `yunwu_chat.mjs` 在 `response_format: json_object` 场景下复用。
 *
 * 要点：思考链可能极长，**首个** `` ```json `` 或首个 `"markdown_body"` 往往是中间分析/示例；
 * 必须优先匹配**最后一次**出现的、且含 EditMap 契约键名的片段。
 */

/**
 * 从 `s[start]` 起截取与 `{`…`}` 平衡的 JSON 对象文本（忽略双引号字符串内的括号）。
 *
 * @param {string} s
 * @param {number} start
 * @returns {string}
 */
function sliceBalancedJsonObject(s, start) {
  if (start < 0 || start >= s.length || s[start] !== '{') {
    return '';
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return s.slice(start, i + 1).trim();
      }
    }
  }
  return '';
}

/**
 * 从 `anchorIndex`（在 `"markdown_body"` 子串附近）向左枚举每一个 `{`，平衡截取；
 * 优先返回**同时含** `"appendix"` 的根级 EditMap 对象（避免只切到嵌套内层）。
 *
 * @param {string} r
 * @param {number} anchorIndex
 * @returns {string}
 */
function sliceFromMarkdownBodyAnchor(r, anchorIndex) {
  /** @type {string[]} */
  const candidates = [];
  for (let j = anchorIndex; j >= 0; j--) {
    if (r[j] !== '{') {
      continue;
    }
    const slice = sliceBalancedJsonObject(r, j);
    if (!slice || !slice.includes('"markdown_body"')) {
      continue;
    }
    candidates.push(slice);
  }
  const withAp = candidates.filter((s) => s.includes('"appendix"'));
  if (withAp.length > 0) {
    return withAp.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  /** 无 appendix 键时取最长候选（更可能是完整根对象而非小片段） */
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  return '';
}

/**
 * 遍历所有 `"markdown_body"` 出现位置，**从后往前**尝试截取（最后一次往往是正式输出）。
 *
 * @param {string} r
 * @returns {string}
 */
function extractViaMarkdownBodyAnchors(r) {
  const needle = '"markdown_body"';
  let searchEnd = r.length;
  while (searchEnd > 0) {
    const idx = r.lastIndexOf(needle, searchEnd - 1);
    if (idx === -1) {
      break;
    }
    const slice = sliceFromMarkdownBodyAnchor(r, idx);
    if (slice) {
      return slice;
    }
    searchEnd = idx;
  }
  return '';
}

/**
 * 取所有 ``` / ```json 围栏，**从后往前**试：优先含 `"markdown_body"` 的块（EditMap 契约）。
 *
 * @param {string} r
 * @returns {string}
 */
function extractViaLastFencedJsonBlocks(r) {
  /** @type {string[]} */
  const inners = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(r)) !== null) {
    const inner = m[1].trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      inners.push(inner);
    }
  }
  for (let i = inners.length - 1; i >= 0; i--) {
    const inner = inners[i];
    if (inner.includes('"markdown_body"')) {
      return inner;
    }
  }
  if (inners.length > 0) {
    return inners[inners.length - 1];
  }
  return '';
}

/**
 * 尽力从 reasoning 中抽出 JSON：优先**最后**的 ```json 围栏（含契约键），
 * 再多次 `"markdown_body"` 锚点（从后往前），最后退回全文**首个**平衡 `{…}`（易误判，放最后）。
 *
 * @param {string} reasoning
 * @returns {string}
 */
export function extractJsonFromReasoningLoose(reasoning) {
  if (typeof reasoning !== 'string') {
    return '';
  }
  const r = reasoning.trim();
  if (!r) {
    return '';
  }

  const fenced = extractViaLastFencedJsonBlocks(r);
  if (fenced) {
    return fenced;
  }

  const anchored = extractViaMarkdownBodyAnchors(r);
  if (anchored) {
    return anchored;
  }

  /** 备用：`appendix` 为 EditMap 顶层键之一（无 markdown_body 字样时的弱锚点） */
  const appendixNeedle = '"appendix"';
  let searchEnd = r.length;
  while (searchEnd > 0) {
    const idx = r.lastIndexOf(appendixNeedle, searchEnd - 1);
    if (idx === -1) {
      break;
    }
    let open = -1;
    for (let j = idx; j >= 0; j--) {
      if (r[j] === '{') {
        open = j;
        break;
      }
    }
    if (open !== -1) {
      const slice = sliceBalancedJsonObject(r, open);
      if (slice && slice.includes(appendixNeedle)) {
        return slice;
      }
    }
    searchEnd = idx;
  }

  const firstBrace = r.indexOf('{');
  if (firstBrace !== -1) {
    const slice = sliceBalancedJsonObject(r, firstBrace);
    if (slice) {
      return slice;
    }
  }
  return '';
}
