#!/usr/bin/env node
/**
 * 将 SD2 流水线「最后一次」产物整理为单一汇总文件：
 * - 每 Block 的最终 sd2_prompt（完整字符串）
 * - 每 Block 在分镜时间片里标注的 @图 标签（去重）
 * - 每 Block 在 payload 中的 asset_tag_mapping、edit_map 的 assets_required（若存在 sd2_payloads.json）
 * - 全剧参考资产表（若存在 edit_map_input.json 的 assetManifest / referenceAssets）
 *
 * 用法:
 *   node scripts/sd2_pipeline/export_sd2_final_report.mjs --sd2-dir output/sd2/<run>/
 *   node scripts/sd2_pipeline/export_sd2_final_report.mjs \
 *     --prompts-all path/to/sd2_prompts_all.json \
 *     [--payloads path/to/sd2_payloads.json] \
 *     [--edit-map-input path/to/edit_map_input.json] \
 *     [--output path/to/sd2_final_report.json]
 *
 * 默认同时生成 **sd2_final_report.md**（人类可读：每 Block 的 sd2_prompt + 资产标签）；
 * 若只要 JSON：加 `--no-markdown`。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 从 SD2Prompter 单块 result 中收集所有 time_slices[].assets_used_tags 并去重排序。
 * @param {unknown} result
 * @returns {string[]}
 */
function collectUniqueAssetTagsFromSlices(result) {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const slices = /** @type {{ time_slices?: unknown }} */ (result).time_slices;
  /** @type {Set<string>} */
  const set = new Set();
  if (!Array.isArray(slices)) {
    return collectAssetTagsFromSd2PromptText(result);
  }
  for (const s of slices) {
    if (!s || typeof s !== 'object') {
      continue;
    }
    const tags = /** @type {{ assets_used_tags?: unknown }} */ (s).assets_used_tags;
    if (!Array.isArray(tags)) {
      continue;
    }
    for (const t of tags) {
      set.add(String(t).trim());
    }
  }
  const fromSlices = [...set].sort((a, b) => a.localeCompare(b));
  if (fromSlices.length > 0) {
    return fromSlices;
  }
  return collectAssetTagsFromSd2PromptText(result);
}

/**
 * v3 等无 time_slices 时：从 sd2_prompt 正文中提取 @图xxx / @asset 类标签。
 * @param {unknown} result
 * @returns {string[]}
 */
function collectAssetTagsFromSd2PromptText(result) {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const prompt = String(
    /** @type {{ sd2_prompt?: unknown }} */ (result).sd2_prompt ?? '',
  );
  if (!prompt.trim()) {
    return [];
  }
  /** @type {Set<string>} */
  const set = new Set();
  const re = /@图[^\s\u3000，。；、]+/g;
  let m = re.exec(prompt);
  while (m) {
    set.add(m[0].trim());
    m = re.exec(prompt);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {unknown} raw
 * @returns {Map<string, { payload?: unknown }>}
 */
function indexPayloadsByBlock(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'object') {
    return map;
  }
  const payloads = /** @type {{ payloads?: unknown }} */ (raw).payloads;
  if (!Array.isArray(payloads)) {
    return map;
  }
  for (const row of payloads) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const bid = /** @type {{ block_id?: string }} */ (row).block_id;
    if (typeof bid === 'string' && bid) {
      map.set(bid, /** @type {{ payload?: unknown }} */ (row));
    }
  }
  return map;
}

/**
 * @param {string} filePath
 * @returns {unknown | null}
 */
function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 将汇总对象转为 Markdown，便于直接阅读与归档（不写进 docs/，仅随跑批目录输出）。
 * @param {Record<string, unknown>} report
 * @returns {string}
 */
function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# SD2 跑批汇总：每 Block 最终 prompt 与资产');
  lines.push('');
  const meta = report.meta && typeof report.meta === 'object' ? report.meta : {};
  lines.push(`- **生成时间**：${String(/** @type {{ report_generated_at?: unknown }} */ (meta).report_generated_at ?? '')}`);
  lines.push(`- **sd2_prompts_all**：\`${String(/** @type {{ sd2_prompts_all?: unknown }} */ (meta).sd2_prompts_all ?? '')}\``);
  lines.push('');

  const ref = report.reference;
  if (ref && typeof ref === 'object') {
    lines.push('## 单集参考与资产白名单（来自 edit_map_input）');
    lines.push('');
    const gs = /** @type {{ global_synopsis?: unknown }} */ (ref).global_synopsis;
    if (gs != null && String(gs).trim()) {
      lines.push('### 梗概 / 编排前缀');
      lines.push('');
      lines.push(String(gs));
      lines.push('');
    }
    const dur = /** @type {{ episode_duration?: unknown }} */ (ref).episode_duration;
    if (dur != null) {
      lines.push(`- **单集时长（秒）**：${String(dur)}`);
      lines.push('');
    }
    lines.push('### asset_manifest（JSON）');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(/** @type {{ asset_manifest?: unknown }} */ (ref).asset_manifest ?? {}, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('### referenceAssets（顺序）');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(/** @type {{ reference_assets?: unknown }} */ (ref).reference_assets ?? [], null, 2));
    lines.push('```');
    lines.push('');
  }

  const blocks = Array.isArray(report.blocks) ? report.blocks : [];
  lines.push(`## 各 Block 输出（共 **${blocks.length}** 个）`);
  lines.push('');
  lines.push(
    '> **为什么有时只有一个 B01？** 单集时长很短（如 15s）时，EditMap 常把整段收成 **1 个 Hook Block**；需要多 Block 时请：**加长 `--duration` / 剧本**、或在准备 EditMap 输入时传 **`--target-block-count`（4–12）** 引导切分。',
  );
  lines.push('');

  for (const b of blocks) {
    if (!b || typeof b !== 'object') {
      continue;
    }
    const bid = String(/** @type {{ block_id?: unknown }} */ (b).block_id ?? '');
    const time = /** @type {{ time?: { start_sec?: number, end_sec?: number, duration?: number } }} */ (b).time;
    const t0 = time && typeof time.start_sec === 'number' ? time.start_sec : 0;
    const t1 = time && typeof time.end_sec === 'number' ? time.end_sec : 0;
    lines.push(`### ${bid}`);
    lines.push('');
    lines.push(`- **时间**：${t0}s – ${t1}s`);
    lines.push(
      `- **时间片用到的 @图 标签（去重）**：${(/** @type {{ assets_used_tags_from_time_slices?: string[] }} */ (b).assets_used_tags_from_time_slices || []).join('、') || '（无）'}`,
    );
    const few = /** @type {{ few_shot_refs?: unknown }} */ (b).few_shot_refs;
    if (Array.isArray(few) && few.length) {
      lines.push(`- **few_shot_refs**：${few.map(String).join(', ')}`);
    }
    lines.push('');
    const bMapping = /** @type {{ asset_tag_mapping?: unknown }} */ (b).asset_tag_mapping;
    const mappingSource = /** @type {{ asset_tag_mapping_source?: string }} */ (b).asset_tag_mapping_source;
    const sourceLabel = mappingSource === 'block_local'
      ? '（Block 内局部映射）'
      : mappingSource === 'global'
        ? '（全局映射）'
        : mappingSource === 'none'
          ? '（无映射）'
          : '';
    lines.push(`#### asset_tag_mapping${sourceLabel}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(bMapping ?? [], null, 2));
    lines.push('```');
    lines.push('');
    lines.push('#### assets_required（EditMap）');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(/** @type {{ assets_required?: unknown }} */ (b).assets_required ?? null, null, 2));
    lines.push('```');
    lines.push('');
    const issues = /** @type {{ sd2_prompt_issues?: unknown }} */ (b).sd2_prompt_issues;
    if (Array.isArray(issues) && issues.length) {
      lines.push('#### sd2_prompt_issues');
      lines.push('');
      for (const it of issues) {
        lines.push(`- ${String(it)}`);
      }
      lines.push('');
    }
    lines.push('#### sd2_prompt（三段式）');
    lines.push('');
    lines.push('```text');
    lines.push(String(/** @type {{ sd2_prompt?: unknown }} */ (b).sd2_prompt ?? ''));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const noMarkdown = Boolean(args['no-markdown']);

  let promptsAllPath = '';
  let payloadsPath = '';
  let editMapInputPath = '';
  let outputPath = '';

  const sd2Dir =
    typeof args['sd2-dir'] === 'string' ? path.resolve(process.cwd(), args['sd2-dir']) : '';

  if (sd2Dir) {
    promptsAllPath = path.join(sd2Dir, 'sd2_prompts_all.json');
    payloadsPath = path.join(sd2Dir, 'sd2_payloads.json');
    editMapInputPath = path.join(sd2Dir, 'edit_map_input.json');
    outputPath = path.join(sd2Dir, 'sd2_final_report.json');
  }

  if (typeof args['prompts-all'] === 'string') {
    promptsAllPath = path.resolve(process.cwd(), args['prompts-all']);
  }
  if (typeof args.payloads === 'string') {
    payloadsPath = path.resolve(process.cwd(), args.payloads);
  }
  if (typeof args['edit-map-input'] === 'string') {
    editMapInputPath = path.resolve(process.cwd(), args['edit-map-input']);
  }
  if (typeof args.output === 'string') {
    outputPath = path.resolve(process.cwd(), args.output);
  }

  if (!promptsAllPath) {
    console.error('请指定 --sd2-dir <目录> 或 --prompts-all <sd2_prompts_all.json>');
    process.exit(2);
  }

  if (!fs.existsSync(promptsAllPath)) {
    console.error(`找不到文件: ${promptsAllPath}`);
    process.exit(2);
  }

  if (!outputPath) {
    outputPath = path.join(path.dirname(promptsAllPath), 'sd2_final_report.json');
  }

  const promptsAll = /** @type {{ meta?: object, blocks?: unknown[] }} */ (
    JSON.parse(fs.readFileSync(promptsAllPath, 'utf8'))
  );
  const blocksRaw = Array.isArray(promptsAll.blocks) ? promptsAll.blocks : [];

  const payloadsRaw = readJsonIfExists(payloadsPath);
  const payloadByBlock = indexPayloadsByBlock(payloadsRaw);

  const editMapInput = readJsonIfExists(editMapInputPath);

  /** @type {Array<Record<string, unknown>>} */
  const blocksOut = [];

  for (const row of blocksRaw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const blockId = /** @type {{ block_id?: string, result?: unknown }} */ (row).block_id;
    const result = /** @type {{ block_id?: string, result?: unknown }} */ (row).result;
    if (typeof blockId !== 'string' || !result || typeof result !== 'object') {
      continue;
    }

    const sd2Prompt = String(
      /** @type {{ sd2_prompt?: unknown }} */ (result).sd2_prompt ?? '',
    );

    const tagsUnique = collectUniqueAssetTagsFromSlices(result);

    const payloadRow = payloadByBlock.get(blockId);
    const inner = payloadRow && payloadRow.payload;

    /**
     * v4 优先使用 Prompter 输出的 block_asset_mapping（Block 内重编号的局部映射，dict 形态：
     *   { "@图1": { asset_id, asset_type }, ... }）；
     * 若不存在则回退到 payload 中的全局 asset_tag_mapping（list 形态）。
     */
    const blockLocalMapping = /** @type {{ block_asset_mapping?: unknown }} */ (result).block_asset_mapping;
    const mapping = (blockLocalMapping && typeof blockLocalMapping === 'object')
      ? blockLocalMapping
      : (inner && typeof inner === 'object'
          ? /** @type {Record<string, unknown>} */ (inner).asset_tag_mapping
            ?? /** @type {Record<string, unknown>} */ (inner).assetTagMapping
          : undefined);

    /**
     * 归一化：无论 Prompter 给的是 dict（{ "@图1": {...} }）还是 list（[{ tag: "@图1", ... }]），
     * 都统一为 list 形态便于报告消费。dict 键按 @图N 数字排序。
     * @returns {Array<Record<string, unknown>>}
     */
    const normalizeMapping = () => {
      if (Array.isArray(mapping)) {
        return /** @type {Array<Record<string, unknown>>} */ (mapping);
      }
      if (mapping && typeof mapping === 'object') {
        const entries = Object.entries(/** @type {Record<string, unknown>} */ (mapping));
        entries.sort((a, b) => {
          const na = Number((a[0].match(/\d+/) || ['0'])[0]);
          const nb = Number((b[0].match(/\d+/) || ['0'])[0]);
          return na - nb;
        });
        return entries.map(([tag, info]) => {
          const rec = (info && typeof info === 'object')
            ? /** @type {Record<string, unknown>} */ (info)
            : {};
          return { tag, ...rec };
        });
      }
      return [];
    };
    const normalizedMapping = normalizeMapping();

    /** v2 通过 edit_map_block.assets_required 读取；v3 没有此嵌套结构 */
    const editBlock =
      inner && typeof inner === 'object'
        ? /** @type {{ edit_map_block?: unknown }} */ (inner).edit_map_block
        : undefined;
    const assetsRequired =
      editBlock && typeof editBlock === 'object'
        ? /** @type {{ assets_required?: unknown }} */ (editBlock).assets_required
        : undefined;

    /**
     * 标记 mapping 来源，供 markdown 渲染时区分"Block 内局部映射"与"全局映射"
     * @type {'block_local' | 'global' | 'none'}
     */
    const mappingSource = blockLocalMapping && typeof blockLocalMapping === 'object'
      ? 'block_local'
      : (normalizedMapping.length > 0 ? 'global' : 'none');

    blocksOut.push({
      block_id: blockId,
      time: /** @type {{ time?: unknown }} */ (result).time ?? null,
      sd2_prompt: sd2Prompt,
      assets_used_tags_from_time_slices: tagsUnique,
      asset_tag_mapping: normalizedMapping,
      asset_tag_mapping_source: mappingSource,
      assets_required: assetsRequired ?? null,
      few_shot_refs:
        /** @type {{ few_shot_refs?: unknown }} */ (result).few_shot_refs ?? null,
      sd2_prompt_issues:
        /** @type {{ sd2_prompt_issues?: unknown }} */ (result).sd2_prompt_issues ?? null,
    });
  }

  blocksOut.sort((a, b) => String(a.block_id).localeCompare(String(b.block_id)));

  /** @type {Record<string, unknown> | null} */
  let reference = null;
  if (editMapInput && typeof editMapInput === 'object') {
    const em = /** @type {{ assetManifest?: unknown, referenceAssets?: unknown, episodeDuration?: unknown, globalSynopsis?: unknown }} */ (
      editMapInput
    );
    reference = {
      global_synopsis: em.globalSynopsis ?? null,
      episode_duration: em.episodeDuration ?? null,
      asset_manifest: em.assetManifest ?? null,
      reference_assets: em.referenceAssets ?? null,
    };
  }

  const report = {
    meta: {
      report_generated_at: new Date().toISOString(),
      sd2_prompts_all: path.resolve(promptsAllPath),
      sd2_payloads: payloadsRaw ? path.resolve(payloadsPath) : null,
      edit_map_input: editMapInput ? path.resolve(editMapInputPath) : null,
      prompter_meta: promptsAll.meta ?? null,
    },
    reference,
    blocks: blocksOut,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`[export_sd2_final_report] 已写入: ${outputPath}`);

  if (!noMarkdown) {
    const mdPath = outputPath.replace(/\.json$/i, '.md');
    fs.writeFileSync(mdPath, buildMarkdownReport(report), 'utf8');
    console.log(`[export_sd2_final_report] 已写入: ${mdPath}`);
  }
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[export_sd2_final_report]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
