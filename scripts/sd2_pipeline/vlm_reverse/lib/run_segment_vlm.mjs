/**
 * 对单个片段调用 VLM 并写出原始 JSON + 规范化 Markdown。
 */
import fs from 'fs';
import path from 'path';
import { generateContentWithVideo } from './gemini_video_vlm.mjs';
import { buildReverseJsonPrompt } from './vlm_reverse_prompt.mjs';
import { formatAssetsForPrompt, loadAssetRegistry } from './asset_registry.mjs';
import { loadSd2SpecText, truncateSpecForPrompt } from './sd2_spec.mjs';
import { normalizeToSd2Markdown } from './normalize_sd2_prompt.mjs';
import {
  resolveStoryboardJsonPath,
  loadStoryboard,
  findOverlappingShots,
  collectSceneGroupsForShots,
  formatStoryboardBlockForPrompt,
} from './storyboard_loader.mjs';
import { formatAliasHintForPrompt } from './camera_alias.mjs';

/**
 * @typedef {object} SegmentRow
 * @property {number} seg_id
 * @property {string} video_file
 * @property {number} duration_s
 * @property {string} video_path
 * @property {number} [start_s]   在完整视频时间轴上的起点（秒），用于客户分镜时间匹配
 * @property {number} [end_s]     在完整视频时间轴上的终点（秒），用于客户分镜时间匹配
 * @property {string} [notes]
 */

/**
 * 懒加载 storyboard，避免每个 seg 重复 IO。
 * @type {import('./storyboard_loader.mjs').Storyboard | null | undefined}
 */
let _cachedStoryboard;

/**
 * @param {string} repoRoot
 * @returns {import('./storyboard_loader.mjs').Storyboard | null}
 */
function getStoryboardOnce(repoRoot) {
  if (_cachedStoryboard !== undefined) return _cachedStoryboard;
  try {
    const p = resolveStoryboardJsonPath(repoRoot);
    _cachedStoryboard = p ? loadStoryboard(p) : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[run_segment_vlm] 加载 storyboard 失败，本次忽略：${msg}`);
    _cachedStoryboard = null;
  }
  return _cachedStoryboard;
}

/**
 * @param {object} ctx
 * @param {string} ctx.repoRoot
 * @param {SegmentRow} ctx.segment
 * @param {string} ctx.model
 * @param {string} ctx.rawDir   原始 JSON 输出目录
 * @param {string} ctx.mdDir    规范化 md 输出目录
 * @returns {Promise<{ ok: boolean; error?: string; elapsedMs?: number; rawPath?: string }>}
 */
export async function runSegmentVlm(ctx) {
  const { manifest } = loadAssetRegistry(ctx.repoRoot);
  const assetsBlock = formatAssetsForPrompt(manifest);
  const specFull = loadSd2SpecText(ctx.repoRoot);
  const specBlock = truncateSpecForPrompt(specFull, 12000);

  const sb = getStoryboardOnce(ctx.repoRoot);
  /** @type {import('./storyboard_loader.mjs').StoryboardShot[]} */
  let overlappingShots = [];
  /** @type {import('./storyboard_loader.mjs').StoryboardSceneGroup[]} */
  let overlappingGroups = [];
  let storyboardBlock = '';
  let aliasHint = '';
  if (
    sb &&
    typeof ctx.segment.start_s === 'number' &&
    typeof ctx.segment.end_s === 'number'
  ) {
    overlappingShots = findOverlappingShots(
      sb,
      ctx.segment.start_s,
      ctx.segment.end_s,
    );
    if (overlappingShots.length > 0) {
      overlappingGroups = collectSceneGroupsForShots(sb, overlappingShots);
      storyboardBlock = formatStoryboardBlockForPrompt({
        segId: ctx.segment.seg_id,
        startS: ctx.segment.start_s,
        endS: ctx.segment.end_s,
        shots: overlappingShots,
        sceneGroups: overlappingGroups,
      });
      aliasHint = formatAliasHintForPrompt();
    }
  }

  const userPrompt = buildReverseJsonPrompt({
    assetsBlock,
    specBlock,
    segId: ctx.segment.seg_id,
    videoFile: ctx.segment.video_file,
    durationS: ctx.segment.duration_s,
    csvNotes: ctx.segment.notes,
    storyboardBlock,
    aliasHint,
  });

  const safeModel = ctx.model.replace(/[^\w.-]+/g, '_');
  const baseName = `seg_${String(ctx.segment.seg_id).padStart(2, '0')}__${safeModel}`;

  try {
    const { rawText, json, elapsedMs } = await generateContentWithVideo(
      ctx.segment.video_path,
      ctx.model,
      userPrompt,
    );

    fs.mkdirSync(ctx.rawDir, { recursive: true });
    const rawPath = path.join(ctx.rawDir, `${baseName}.json`);
    fs.writeFileSync(
      rawPath,
      JSON.stringify(
        {
          meta: {
            model: ctx.model,
            video_path: ctx.segment.video_path,
            seg_id: ctx.segment.seg_id,
            elapsed_ms: elapsedMs,
          },
          raw_text: rawText,
          parsed: json,
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.mkdirSync(ctx.mdDir, { recursive: true });

    const parsed = /** @type {Record<string, unknown>} */ (
      json && typeof json === 'object' ? json : {}
    );

    /** @type {import('./normalize_sd2_prompt.mjs').VlmSegmentJson} */
    const merged = {
      seg_id: ctx.segment.seg_id,
      video_file: ctx.segment.video_file,
      duration_s: ctx.segment.duration_s,
      detected_assets:
        parsed.detected_assets && typeof parsed.detected_assets === 'object'
          ? /** @type {{ characters?: unknown[]; props?: unknown[]; scene?: string | null }} */ (
              parsed.detected_assets
            )
          : { characters: [], props: [], scene: null },
      screen_text: Array.isArray(parsed.screen_text)
        ? /** @type {import('./normalize_sd2_prompt.mjs').ScreenTextItem[]} */ (
            parsed.screen_text
          )
        : [],
      eight_elements:
        parsed.eight_elements && typeof parsed.eight_elements === 'object'
          ? /** @type {Record<string, string>} */ (parsed.eight_elements)
          : {},
      shot_classification:
        parsed.shot_classification &&
        typeof parsed.shot_classification === 'object'
          ? /** @type {{ 景别?: string; 角度?: string; 运镜方式?: string }} */ (
              parsed.shot_classification
            )
          : {},
      raw_prompt_draft:
        typeof parsed.raw_prompt_draft === 'string' ? parsed.raw_prompt_draft : '',
      needs_human_review: Boolean(parsed.needs_human_review),
      review_reasons: Array.isArray(parsed.review_reasons)
        ? /** @type {string[]} */ (parsed.review_reasons).filter(
            (x) => typeof x === 'string',
          )
        : [],
    };
    const norm = normalizeToSd2Markdown(merged, ctx.model);
    const mdPath = path.join(ctx.mdDir, `${baseName}.md`);

    /** @type {string[]} */
    const alignLines = [];
    if (overlappingShots.length > 0) {
      const shotIds = overlappingShots.map((s) => s.shot_no).join(', ');
      const groupKeys = overlappingGroups.map((g) => g.key).join(' / ');
      alignLines.push(
        `## 客户分镜对齐（仅参考，画面以视频为准）`,
        `- 命中客户镜号：${shotIds}`,
        `- 场景组：${groupKeys || '（未命中）'}`,
      );
      for (const s of overlappingShots) {
        const dialog = s.台词 && s.台词 !== '无' ? `；台词：${s.台词}` : '';
        alignLines.push(
          `- 客户镜 ${s.shot_no}（${s.cum_start_s.toFixed(1)}s~${s.cum_end_s.toFixed(1)}s · ${s.景别}/${s.运镜}）：${s.画面描述}${dialog}`,
        );
      }
      alignLines.push('');
    }

    const mdBody = [
      `# seg ${ctx.segment.seg_id} · ${ctx.model}`,
      '',
      '## Warnings',
      norm.warnings.length ? norm.warnings.map((w) => `- ${w}`).join('\n') : '- （无）',
      '',
      ...alignLines,
      norm.markdown,
      '',
    ].join('\n');
    fs.writeFileSync(mdPath, mdBody, 'utf8');

    return { ok: true, elapsedMs, rawPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
