/**
 * 按 injection_map.yaml 将知识切片 Markdown 加载为字符串数组，供 Director / Prompter 注入。
 * 路由规则对齐 SD2Workflow-v4-接入指南与 SD2Workflow-v3.1-接口合同。
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * @param {unknown} blockIndex  appendix.block_index 单条
 * @param {unknown} parsedBrief  meta.parsed_brief
 * @param {Record<string, unknown>} match  YAML match 段
 * @returns {boolean}
 */
function matchSliceConditions(blockIndex, parsedBrief, match) {
  if (!match || typeof match !== 'object') {
    return true;
  }
  const bi =
    blockIndex && typeof blockIndex === 'object'
      ? /** @type {Record<string, unknown>} */ (blockIndex)
      : {};
  const pb =
    parsedBrief && typeof parsedBrief === 'object'
      ? /** @type {Record<string, unknown>} */ (parsedBrief)
      : {};

  for (const key of Object.keys(match)) {
    const condition = /** @type {Record<string, unknown>} */ (match)[key];
    if (key === 'aspect_ratio') {
      const want = String(condition);
      const ar =
        typeof pb.aspectRatio === 'string'
          ? pb.aspectRatio
          : typeof pb.aspect_ratio === 'string'
            ? pb.aspect_ratio
            : '';
      if (ar !== want) {
        return false;
      }
    } else if (key === 'structural_tags') {
      const cond =
        condition && typeof condition === 'object'
          ? /** @type {{ any_of?: unknown }} */ (condition)
          : {};
      const anyOf = Array.isArray(cond.any_of) ? cond.any_of.map(String) : [];
      const tags = Array.isArray(bi.structural_tags)
        ? bi.structural_tags.map(String)
        : [];
      const hit = anyOf.some((t) => tags.includes(t));
      if (!hit) {
        return false;
      }
    } else if (key === 'scene_bucket') {
      const want = String(condition);
      const got = typeof bi.scene_bucket === 'string' ? bi.scene_bucket : '';
      if (got !== want) {
        return false;
      }
    }
  }
  return true;
}

/**
 * @param {unknown} entry  always / conditional 数组元素
 * @param {string} slicesRoot  4_KnowledgeSlices 绝对路径
 * @returns {string}
 */
function readSliceFile(entry, slicesRoot) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  const p = /** @type {{ path?: string }} */ (entry).path;
  if (typeof p !== 'string' || !p.trim()) {
    return '';
  }
  const abs = path.join(slicesRoot, p.trim());
  if (!fs.existsSync(abs)) {
    console.warn(`[knowledge_slices] 切片文件不存在，跳过: ${abs}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * @param {string} slicesRoot  4_KnowledgeSlices 目录（含 injection_map.yaml）
 * @returns {Record<string, unknown>}
 */
function loadInjectionConfig(slicesRoot) {
  const mapPath = path.join(slicesRoot, 'injection_map.yaml');
  if (!fs.existsSync(mapPath)) {
    console.warn(`[knowledge_slices] 未找到 ${mapPath}，不注入切片`);
    return {};
  }
  const raw = fs.readFileSync(mapPath, 'utf8');
  return /** @type {Record<string, unknown>} */ (parseYaml(raw));
}

/**
 * @param {'director'|'prompter'} consumer
 * @param {unknown} blockIndex  当前组 block_index 条目
 * @param {unknown} parsedBrief  meta.parsed_brief
 * @param {string} slicesRoot  4_KnowledgeSlices 绝对路径
 * @returns {string[]}
 */
export function loadKnowledgeSlicesForConsumer(consumer, blockIndex, parsedBrief, slicesRoot) {
  const config = loadInjectionConfig(slicesRoot);
  const section = config[consumer];
  if (!section || typeof section !== 'object') {
    return [];
  }
  const sec = /** @type {{ always?: unknown[], conditional?: unknown[] }} */ (section);
  /** @type {string[]} */
  const out = [];

  const always = Array.isArray(sec.always) ? sec.always : [];
  for (const entry of always) {
    const text = readSliceFile(entry, slicesRoot);
    if (text) {
      out.push(text);
    }
  }

  const conditional = Array.isArray(sec.conditional) ? sec.conditional : [];
  for (const entry of conditional) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const e = /** @type {{ match?: unknown }} */ (entry);
    const m = e.match;
    const matchObj =
      m && typeof m === 'object' ? /** @type {Record<string, unknown>} */ (m) : {};
    if (!matchSliceConditions(blockIndex, parsedBrief, matchObj)) {
      continue;
    }
    const text = readSliceFile(entry, slicesRoot);
    if (text) {
      out.push(text);
    }
  }

  return out;
}

/**
 * 将切片拼到系统提示词末尾（合同：注入在 system prompt 末尾）
 * @param {string} baseSystemPrompt
 * @param {string[]} slices
 * @returns {string}
 */
export function appendKnowledgeSlicesToSystemPrompt(baseSystemPrompt, slices) {
  if (!slices.length) {
    return baseSystemPrompt;
  }
  const body = slices
    .map((s, i) => `### 注入切片 ${i + 1}\n\n${s.trim()}`)
    .join('\n\n---\n\n');
  return `${baseSystemPrompt.trim()}\n\n---\n\n## 编排层注入：知识切片（knowledgeSlices）\n\n${body}\n`;
}

/**
 * 供 user JSON 使用：避免与 system 内切片重复，可从 payload 中剔除 knowledgeSlices。
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
export function omitKnowledgeSlicesFromPayload(payload) {
  const { knowledgeSlices: _ks, ...rest } = payload;
  return rest;
}
