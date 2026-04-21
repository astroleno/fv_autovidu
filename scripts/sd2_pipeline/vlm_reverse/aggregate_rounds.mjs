/**
 * 汇总多轮 compare_r{N}/ 下的 raw JSON，打一张横向对比表，评估质量与稳定性。
 *
 * 用法：
 *   node scripts/sd2_pipeline/vlm_reverse/aggregate_rounds.mjs
 *
 * 环境变量：
 *   VLM_ROUNDS=1,2,3                要汇总的轮次（对应 compare_rN/）
 *   VLM_COMPARE_SEG_IDS=1,10,23    要汇总的 seg_id 列表（与 compare 保持一致）
 *   VLM_MODEL_FOR_ROUNDS=gemini-3-flash-preview  多轮测试的主力模型
 *
 * 输出：
 *   output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse/rounds_quality_report.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveRepoRootFromHere } from './lib/asset_registry.mjs';
import {
  detectCameraIssues,
  detectDraftIssues,
} from './lib/normalize_sd2_prompt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

/**
 * @param {string} s
 * @returns {number[]}
 */
function parseIdList(s) {
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

/**
 * 质量评分：基于 SD2 官方规范的关键项逐项打分（0/1/2）。
 *   - mapping_score:   白名单命中的角色/道具数（上限 5）
 *   - eight_full_score: 八大要素填齐程度（0-8）
 *   - camera_single_ok: 运镜合规（0 or 1）
 *   - draft_figure_ok: 粗稿使用 @图N 且断句合规（0 or 1）
 *   - screen_text_count: 画面文字抓取数量（上限 5）
 *   - action_detail_len: 动作字段字数（越多越细，但封顶 120）
 *
 * @param {Record<string, unknown>} parsed
 * @returns {{
 *   mapping_score: number;
 *   eight_full_score: number;
 *   camera_single_ok: number;
 *   draft_figure_ok: number;
 *   screen_text_count: number;
 *   action_detail_len: number;
 *   total: number;
 *   issues: string[];
 * }}
 */
function scoreOne(parsed) {
  const issues = [];
  const da = /** @type {{ characters?: unknown[]; props?: unknown[] }} */ (
    parsed?.detected_assets || {}
  );
  const charLen = Array.isArray(da.characters)
    ? da.characters.filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          typeof (/** @type {{ name?: unknown }} */ (c).name) === 'string' &&
          /** @type {{ name: string }} */ (c).name.trim(),
      ).length
    : 0;
  const propLen = Array.isArray(da.props)
    ? da.props.filter(
        (p) =>
          p &&
          typeof p === 'object' &&
          typeof (/** @type {{ name?: unknown }} */ (p).name) === 'string' &&
          /** @type {{ name: string }} */ (p).name.trim(),
      ).length
    : 0;
  const mapping_score = Math.min(5, charLen + propLen);

  const ee = /** @type {Record<string, unknown>} */ (parsed?.eight_elements || {});
  const eightKeys = ['主体', '动作', '场景', '光影', '运镜', '风格', '画质', '约束'];
  let eight_full_score = 0;
  for (const k of eightKeys) {
    const v = ee[k];
    if (typeof v === 'string' && v.trim().length >= 4) {
      eight_full_score += 1;
    }
  }

  const cameraRaw = typeof ee.运镜 === 'string' ? ee.运镜 : '';
  const camIssues = detectCameraIssues(cameraRaw);
  const camera_single_ok = camIssues.length === 0 ? 1 : 0;
  if (camIssues.length > 0) {
    issues.push(...camIssues);
  }

  const draft = typeof parsed?.raw_prompt_draft === 'string'
    ? /** @type {string} */ (parsed.raw_prompt_draft)
    : '';
  const draftIssues = detectDraftIssues(draft);
  const hasFigure = /@图\d+/.test(draft);
  const hasMappable = charLen + propLen > 0;
  let draft_figure_ok;
  if (!hasMappable) {
    draft_figure_ok = 1;
  } else {
    draft_figure_ok = hasFigure && draftIssues.length === 0 ? 1 : 0;
    if (!hasFigure) issues.push('粗稿未使用 @图N 强指代');
  }
  if (draftIssues.length > 0) issues.push(...draftIssues);

  const st = Array.isArray(parsed?.screen_text)
    ? /** @type {unknown[]} */ (parsed.screen_text)
    : [];
  const screen_text_count = Math.min(
    5,
    st.filter(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof (/** @type {{ content?: unknown }} */ (x).content) === 'string' &&
        /** @type {{ content: string }} */ (x).content.trim(),
    ).length,
  );

  const actionStr = typeof ee.动作 === 'string' ? ee.动作.trim() : '';
  const action_detail_len = Math.min(120, actionStr.length);

  const total =
    mapping_score * 2 +
    eight_full_score * 1 +
    camera_single_ok * 3 +
    draft_figure_ok * 4 +
    screen_text_count * 2 +
    Math.round(action_detail_len / 12);

  return {
    mapping_score,
    eight_full_score,
    camera_single_ok,
    draft_figure_ok,
    screen_text_count,
    action_detail_len,
    total,
    issues,
  };
}

async function main() {
  const repoRoot = resolveRepoRootFromHere();
  const rounds = parseIdList(process.env.VLM_ROUNDS || '1,2,3');
  const segIds = parseIdList(process.env.VLM_COMPARE_SEG_IDS || '1,10,23');
  const model =
    process.env.VLM_MODEL_FOR_ROUNDS || 'gemini-3-flash-preview';
  const safeModel = model.replace(/[^\w.-]+/g, '_');

  const outBase = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse',
  );

  /**
   * @typedef {ReturnType<typeof scoreOne>} OneScore
   * @type {{ round: number; segId: number; score: OneScore | null; elapsedMs: number | null; note: string }[]}
   */
  const rows = [];
  for (const r of rounds) {
    const dir = path.join(outBase, 'raw', `compare_r${r}`);
    for (const segId of segIds) {
      const baseName = `seg_${String(segId).padStart(2, '0')}__${safeModel}.json`;
      const p = path.join(dir, baseName);
      if (!fs.existsSync(p)) {
        rows.push({
          round: r,
          segId,
          score: null,
          elapsedMs: null,
          note: `缺文件 ${path.relative(repoRoot, p)}`,
        });
        continue;
      }
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const parsed = j?.parsed && typeof j.parsed === 'object' ? j.parsed : {};
      const s = scoreOne(parsed);
      rows.push({
        round: r,
        segId,
        score: s,
        elapsedMs: typeof j?.meta?.elapsed_ms === 'number' ? j.meta.elapsed_ms : null,
        note: '',
      });
    }
  }

  const lines = [
    '# 多轮 VLM 质量对比',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 模型：\`${model}\``,
    `- 轮次：${rounds.join(', ')}`,
    `- 片段：${segIds.join(', ')}`,
    '',
    '## 评分规则（对齐 `sd2官方提示词.md`）',
    '',
    '| 维度 | 含义 | 权重 |',
    '|---|---|---|',
    '| mapping_score | 白名单命中角色+道具数（≤5） | ×2 |',
    '| eight_full_score | 八大要素中填写≥4字的个数（0-8） | ×1 |',
    '| camera_single_ok | 运镜命中官方白名单且无冲突 | ×3 |',
    '| draft_figure_ok | 粗稿使用 @图N 且断句合规 | ×4 |',
    '| screen_text_count | 画面文字捕获数（≤5） | ×2 |',
    '| action_detail_len | 动作字段字数（≤120） | ×(1/12) |',
    '',
    '## 明细表',
    '',
    '| 轮次 | seg | mapping | 8要素 | 运镜 | 粗稿@图N | 画面文字 | 动作字数 | **综合** | 耗时(ms) |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];

  for (const row of rows) {
    if (!row.score) {
      lines.push(
        `| r${row.round} | ${row.segId} | - | - | - | - | - | - | - | - · ${row.note} |`,
      );
      continue;
    }
    const s = row.score;
    const figureCell =
      s.mapping_score === 0 ? 'N/A' : s.draft_figure_ok ? '✅' : '❌';
    lines.push(
      `| r${row.round} | ${row.segId} | ${s.mapping_score} | ${s.eight_full_score}/8 | ${s.camera_single_ok ? '✅' : '❌'} | ${figureCell} | ${s.screen_text_count} | ${s.action_detail_len} | **${s.total}** | ${row.elapsedMs ?? '-'} |`,
    );
  }

  lines.push('', '## 按 seg 聚合（稳定性）', '');
  lines.push('| seg | 各轮综合分 | 平均 | min~max |');
  lines.push('|---|---|---|---|');
  for (const segId of segIds) {
    const items = rows
      .filter((r) => r.segId === segId && r.score)
      .map((r) => /** @type {OneScore} */ (r.score).total);
    if (items.length === 0) {
      lines.push(`| ${segId} | - | - | - |`);
      continue;
    }
    const avg = items.reduce((a, b) => a + b, 0) / items.length;
    lines.push(
      `| ${segId} | ${items.join(', ')} | ${avg.toFixed(1)} | ${Math.min(...items)} ~ ${Math.max(...items)} |`,
    );
  }

  lines.push('', '## 问题归集（所有轮次）', '');
  const allIssues = new Map();
  for (const row of rows) {
    if (!row.score) continue;
    for (const issue of row.score.issues) {
      const key = issue;
      allIssues.set(key, (allIssues.get(key) || 0) + 1);
    }
  }
  if (allIssues.size === 0) {
    lines.push('- （无）');
  } else {
    for (const [k, v] of [...allIssues.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ×${v}：${k}`);
    }
  }

  const out = path.join(outBase, 'rounds_quality_report.md');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`[aggregate_rounds] 报告：${out}`);
}

main().catch((e) => {
  console.error('[aggregate_rounds]', e.message || e);
  process.exit(1);
});
