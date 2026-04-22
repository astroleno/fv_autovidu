#!/usr/bin/env node
/**
 * SD2 本地流水线编排：可选拉取 Feeling → 准备 EditMap 输入 → LLM EditMap → 胶水 payload → LLM SD2Prompter。
 *
 * 用法示例:
 *   node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
 *     --episode-json data/.../episode.json \
 *     --script-file public/script/test/e1.md \
 *     --brief "单集总时长120秒；目标镜头数约60。现代都市医疗情感短剧，真人电影风格。冷调偏青，高反差，低饱和。"
 *
 * 等价于分字段模式：
 *   node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
 *     --episode-json data/.../episode.json \
 *     --script-file public/script/test/e1.md \
 *     --duration 120 --shot-hint 60 \
 *     --genre sweet_romance \
 *     --rendering-style "真人电影" \
 *     --art-style "冷调偏青，高反差，低饱和" \
 *     [--target-block-count 6]
 *
 * --brief 和 --brief-file 为新增的"导演简报"模式，一段话描述所有参数，由 EditMap（Opus）解析。
 * 也可同时使用 --brief + 单字段覆写（如 --brief "..." --genre revenge），此时显式字段优先。
 *
 * 参数（节选）:
 *   --genre <枚举>  可选；sweet_romance | revenge | suspense | fantasy | general。
 *                   传入时写入 edit_map_input.json 的 genre，EditMap 按题材加权；不传则由 LLM 从梗概+剧本推断，写入输出 meta.genre。
 *   --rendering-style / --art-style  可选；也可在 edit_map_input.json 顶层写 renderingStyle、artStyle。
 *                   合并优先级：CLI > edit_map_input > edit_map_sd2.meta > 默认。
 *
 * 仅重跑 EditMap + payload（不覆盖已生成的 SD2 最终提示词）:
 *   node scripts/sd2_pipeline/run_sd2_pipeline.mjs ... --skip-prompter
 *
 * v2 三阶段：EditMap（可选 --yunwu/Opus）→ 每 Block 内 SD2Director→SD2Prompter 串联；Block 之间全并发 + stagger（call_sd2_block_chain.mjs）。
 * 跳过中间导演：--skip-director（仅 EditMap → Prompter，payload 不含 sd2_director）。
 * 仅跑 EditMap+payload、不跑 Director/Prompter LLM：--skip-prompter（分阶段：先全量 Director 再写 payload，不跑 Prompter）。
 * --dry-run：不调用任何 LLM；需已有 edit_map_sd2.json。
 * --yunwu 时可选 --no-thinking：关闭云雾思考模式，减少输出被截断导致 EditMap JSON 不完整（与 jsonrepair 容错配合）。
 * --prompter-prompt <path>：覆盖 SD2Prompter 系统提示词（默认 prompt/.../2_SD2Prompter-v2.md；也可用环境变量 SD2_PROMPTER_PROMPT）。
 * --sd2-version v2|v3|v4|v5：v3/v4/v5 使用 Markdown+appendix 管线；v4 含知识切片注入+continuity；
 *                          v5 进一步用 canonical routing（structural / satisfaction / psychology_group /
 *                          shot_hint / paywall_level）匹配切片，并产出 sd2_routing_trace.json 审计
 *                          （见 prompt/1_SD2Workflow/docs/v5/）。（默认 v2）
 * --edit-map-input <path>：直接复制为输出目录下的 edit_map_input.json，跳过 prepare_editmap_input（可与 --episode-json 同用）。
 * --yunwu：EditMap 第一步走云雾（默认 YUNWU_MODEL=Opus 等），Director/Prompter 仍走 SD2_LLM_*。
 *           传 --yunwu 时若未设 --downstream-model，自动将本进程 SD2_LLM_MODEL=qwen-plus，避免与 Opus 混用同 env。
 * --downstream-model <id>：显式指定 Director / Prompter / Block 链用的模型（写入 SD2_LLM_MODEL），例如 qwen-plus、qwen-turbo。
 * --normalizer（仅 v5）：Stage 0 ScriptNormalizer 默认走 DashScope（同上 SD2_LLM_MODEL，如 qwen-plus），与 EditMap 云雾 Opus 解耦。
 *           若需 Stage 0 也走云雾，设环境变量 SD2_NORMALIZER_USE_YUNWU=1（且本进程带 --yunwu）。
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { resolveSd2StyleHints } from './lib/edit_map_style_hints.mjs';
import { buildAllDirectorPayloadsV3 } from './lib/sd2_v3_payloads.mjs';
import { buildAllDirectorPayloadsV4 } from './lib/sd2_v4_payloads.mjs';
import { buildAllDirectorPayloadsV5 } from './lib/sd2_v5_payloads.mjs';
import { buildAllDirectorPayloadsV6 } from './lib/sd2_v6_payloads.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * @param {string[]} argv
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
 * @param {string[]} nodeArgs
 * @param {string} [cwd]
 */
function runNode(nodeArgs, cwd = REPO_ROOT) {
  const r = spawnSync(process.execPath, nodeArgs, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`命令失败 (exit ${r.status}): node ${nodeArgs.join(' ')}`);
  }
}

/**
 * @param {string[]} pyArgs
 */
function runPython(pyArgs) {
  const opts = {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  };
  let r = spawnSync('python', ['-u', ...pyArgs], opts);
  if (r.status === 0) {
    return;
  }
  r = spawnSync('python3', ['-u', ...pyArgs], opts);
  if (r.status !== 0) {
    throw new Error(`python/python3 拉取失败: ${pyArgs.join(' ')}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const projectId = typeof args['project-id'] === 'string' ? args['project-id'] : '';
  const episodeIdArg = typeof args['episode-id'] === 'string' ? args['episode-id'] : '';
  let episodeJson =
    typeof args['episode-json'] === 'string'
      ? path.resolve(process.cwd(), args['episode-json'])
      : '';

  if (args.pull && projectId && episodeIdArg) {
    console.log('[run_sd2_pipeline] 拉取 Feeling 剧集 …');
    runPython([
      path.join('src', 'feeling', 'puller.py'),
      '--episode-id',
      episodeIdArg,
      '--project-id',
      projectId,
      '--output',
      'data',
    ]);
    episodeJson = path.join(
      REPO_ROOT,
      'data',
      projectId,
      episodeIdArg,
      'episode.json',
    );
  }

  const editMapInputOverride =
    typeof args['edit-map-input'] === 'string' && args['edit-map-input'].trim()
      ? path.resolve(process.cwd(), args['edit-map-input'].trim())
      : '';

  if (editMapInputOverride && fs.existsSync(editMapInputOverride)) {
    const siblingEpisode = path.join(path.dirname(editMapInputOverride), 'episode.json');
    if ((!episodeJson || !fs.existsSync(episodeJson)) && fs.existsSync(siblingEpisode)) {
      episodeJson = siblingEpisode;
    }
  }

  if (!episodeJson || !fs.existsSync(episodeJson)) {
    console.error(
      '请提供 --episode-json，或与 --edit-map-input 同目录下的 episode.json，或使用 --pull --project-id <uuid> --episode-id <uuid>',
    );
    process.exit(2);
  }

  const epData = JSON.parse(fs.readFileSync(episodeJson, 'utf8'));
  const episodeId = String(epData.episodeId || path.basename(path.dirname(episodeJson)));

  const outRoot =
    typeof args['output-dir'] === 'string'
      ? path.resolve(process.cwd(), args['output-dir'])
      : path.join(REPO_ROOT, 'output', 'sd2', episodeId);

  const editMapInput = path.join(outRoot, 'edit_map_input.json');
  const editMapOut = path.join(outRoot, 'edit_map_sd2.json');
  /**
   * Stage 0 · ScriptNormalizer 产物（仅 v5 且显式 --normalizer 时生成）。
   * 详见 prompt/1_SD2Workflow/docs/stage0-normalizer/00_ScriptNormalizer-v1-计划.md。
   */
  const normalizerOut = path.join(outRoot, 'normalized_script_package.json');
  const directorPayloads = path.join(outRoot, 'sd2_director_payloads.json');
  const directorPromptsDir = path.join(outRoot, 'director_prompts');
  const directorAll = path.join(outRoot, 'sd2_director_all.json');
  const payloadsOut = path.join(outRoot, 'sd2_payloads.json');
  const promptsDir = path.join(outRoot, 'prompts');

  const dryRun = Boolean(args['dry-run']);
  /** dry-run 不调用任何 LLM：等同跳过 EditMap，需已有 edit_map_sd2.json */
  const skipEditmap = Boolean(args['skip-editmap']) || dryRun;
  const skipDirector = Boolean(args['skip-director']);
  const skipPrompter = Boolean(args['skip-prompter']);
  const kbDirRel = path.join('prompt', '1_SD2Workflow', '3_FewShotKnowledgeBase');
  const staggerMsArg =
    typeof args['stagger-ms'] === 'string' && args['stagger-ms'] !== ''
      ? args['stagger-ms']
      : '400';

  const sd2VersionRaw =
    typeof args['sd2-version'] === 'string' && args['sd2-version'].trim()
      ? String(args['sd2-version']).trim().toLowerCase()
      : 'v2';
  const sd2Version =
    sd2VersionRaw === 'v6'
      ? 'v6'
      : sd2VersionRaw === 'v5'
        ? 'v5'
        : sd2VersionRaw === 'v4'
          ? 'v4'
          : sd2VersionRaw === 'v3'
            ? 'v3'
            : 'v2';

  const isMdPipeline =
    sd2Version === 'v3' || sd2Version === 'v4' || sd2Version === 'v5' || sd2Version === 'v6';

  if (isMdPipeline && skipDirector && !skipPrompter) {
    throw new Error(
      'SD2 v3/v4/v5 不支持仅跳过 Director 仍跑 Prompter；请去掉 --skip-director 或加上 --skip-prompter',
    );
  }

  fs.mkdirSync(outRoot, { recursive: true });

  if (editMapInputOverride) {
    if (!fs.existsSync(editMapInputOverride)) {
      throw new Error(`--edit-map-input 文件不存在: ${editMapInputOverride}`);
    }
    fs.copyFileSync(editMapInputOverride, editMapInput);
    console.log(`[run_sd2_pipeline] 已复制 --edit-map-input → ${editMapInput}，跳过 prepare_editmap_input`);
  }

  const scriptFile = typeof args['script-file'] === 'string' ? args['script-file'] : '';
  const globalSynopsis =
    typeof args['global-synopsis'] === 'string' ? args['global-synopsis'] : '';
  const globalSynopsisFile =
    typeof args['global-synopsis-file'] === 'string' ? args['global-synopsis-file'] : '';
  const durationArg = typeof args.duration === 'string' ? args.duration : '';
  const shotHintArg = typeof args['shot-hint'] === 'string' ? args['shot-hint'] : '';
  const motionBiasArg = typeof args['motion-bias'] === 'string' ? args['motion-bias'] : '';
  const genreArg = typeof args['genre'] === 'string' ? args['genre'] : '';
  const targetBlockCountArg =
    typeof args['target-block-count'] === 'string' ? args['target-block-count'] : '';
  const prompterPromptArg =
    typeof args['prompter-prompt'] === 'string' ? args['prompter-prompt'] : '';
  const renderingStyleCli =
    typeof args['rendering-style'] === 'string' && args['rendering-style'].trim()
      ? args['rendering-style'].trim()
      : '';
  const artStyleCli =
    typeof args['art-style'] === 'string' && args['art-style'].trim()
      ? args['art-style'].trim()
      : '';
  const briefCli = typeof args['brief'] === 'string' ? args['brief'].trim() : '';
  const briefFileCli = typeof args['brief-file'] === 'string' ? args['brief-file'] : '';

  /** @type {string[]} */
  const prepArgs = [
    path.join('scripts', 'sd2_pipeline', 'prepare_editmap_input.mjs'),
    '--episode',
    episodeJson,
    '--output',
    editMapInput,
  ];
  if (scriptFile) {
    prepArgs.push('--script-file', path.resolve(process.cwd(), scriptFile));
  }
  if (globalSynopsisFile) {
    prepArgs.push(
      '--global-synopsis-file',
      path.resolve(process.cwd(), globalSynopsisFile),
    );
  } else if (globalSynopsis) {
    prepArgs.push('--global-synopsis', globalSynopsis);
  }
  if (durationArg) {
    prepArgs.push('--duration', durationArg);
  }
  /**
   * v5.0-rev3 · Scheme B · deprecate warning：
   *   --shot-hint / --target-block-count 不再进数据字段（workflowControls 已删），
   *   prepare 层会把它们合并到 directorBrief 文末作为"软 hint"。
   *   这里只打一条提示，保持 CLI 向后兼容。
   */
  if (shotHintArg) {
    prepArgs.push('--shot-hint', shotHintArg);
    if (sd2Version === 'v5') {
      console.warn(
        `[run_sd2_pipeline] ⚠ --shot-hint=${shotHintArg}：v5 已改为 brief 驱动推理，此值将作为"软 hint"合入 directorBrief 文末，不再进 workflowControls 数据字段。\n` +
          `    建议：把镜头偏好写进 --brief 自然语言里（如"节奏偏紧，镜头 60 左右"），更符合 v5 Scheme B 设计。`,
      );
    }
  }
  if (motionBiasArg) {
    prepArgs.push('--motion-bias', motionBiasArg);
  }
  if (genreArg) {
    prepArgs.push('--genre', genreArg);
  }
  if (targetBlockCountArg) {
    prepArgs.push('--target-block-count', targetBlockCountArg);
    if (sd2Version === 'v5') {
      console.warn(
        `[run_sd2_pipeline] ⚠ --target-block-count=${targetBlockCountArg}：v5 已改为 brief 驱动推理，此值将作为"软 hint"合入 directorBrief 文末，Block 切分仍由 LLM 基于剧本决定。`,
      );
    }
  }
  if (renderingStyleCli) {
    prepArgs.push('--rendering-style', renderingStyleCli);
  }
  if (artStyleCli) {
    prepArgs.push('--art-style', artStyleCli);
  }
  if (briefFileCli) {
    prepArgs.push('--brief-file', path.resolve(process.cwd(), briefFileCli));
  } else if (briefCli) {
    prepArgs.push('--brief', briefCli);
  }

  if (!editMapInputOverride) {
    console.log('[run_sd2_pipeline] 准备 edit_map_input.json …');
    runNode(prepArgs);
  }

  if (dryRun && !fs.existsSync(editMapOut)) {
    throw new Error(
      `dry-run 不调用 LLM：请先生成 ${editMapOut}（完整跑一次去掉 --dry-run，或复制 edit_map 到该路径）`,
    );
  }

  const useYunwu = Boolean(args.yunwu);
  const downstreamModelCli =
    typeof args['downstream-model'] === 'string' && args['downstream-model'].trim()
      ? String(args['downstream-model']).trim()
      : '';
  if (downstreamModelCli) {
    process.env.SD2_LLM_MODEL = downstreamModelCli;
    console.log(
      `[run_sd2_pipeline] 下游 Block 链 / Director / Prompter：SD2_LLM_MODEL=${downstreamModelCli}`,
    );
  } else if (useYunwu) {
    process.env.SD2_LLM_MODEL = 'qwen-plus';
    console.log(
      '[run_sd2_pipeline] --yunwu：EditMap 使用云雾；下游已设 SD2_LLM_MODEL=qwen-plus（可加 --downstream-model 覆盖）',
    );
  }

  /**
   * v5.0-rev2 · 防呆警示：`--no-thinking × v5 EditMap` 是已知风险组合。
   *
   * 背景：v5 EditMap Prompt §0（推理前置铁律）要求 LLM **先** 逐段预估时长、**再**切 Block、
   *       **再**自检 ≤15s。这段"多步链式推理"高度依赖 thinking chain 展开。关掉 thinking 后，
   *       Opus 更倾向直接吐 Block 产物，容易踩 §0 的 `max_block_duration_check` 硬门
   *       （call_yunwu_editmap_sd2_v5.mjs H1：仍 false → exit 7 拒绝写盘）。
   *
   * 这里只发警示、不阻断——用户显式加了 `--no-thinking`，就尊重选择（也许剧本很短很稀疏，thinking 是浪费）。
   * 但把风险写在眼前，避免下一次再看到 exit 7 时不知道为什么。
   */
  if (args['no-thinking'] === true && sd2Version === 'v5') {
    console.warn(
      '[run_sd2_pipeline] ⚠️  --no-thinking × v5 EditMap：Prompt §0（时长预推理）依赖 thinking chain，\n' +
        '    关掉 thinking 后 Block 时长容易踩 ≤15s 硬门（call_yunwu_editmap_sd2_v5 H1 会 exit 7 拒写）。\n' +
        '    建议：1) 默认 **不加** --no-thinking；2) 若剧本确实稀疏短小再用。\n' +
        '    （v5.0-rev3 起 Block 切分 / 镜头数等由 LLM 从 directorBrief + 剧本推理，不再依赖输入侧数字。）',
    );
  }

  /**
   * Stage 0 · ScriptNormalizer：
   *   - v5：opt-in（需 `--normalizer`），调度 `call_script_normalizer_v1.mjs`；
   *   - v6：**默认开启**（剧本真相源由 Normalizer v2 提供，scriptChunk 依赖它）；
   *         可通过 `--no-normalizer` 强制关闭（降级到 v5 行为，所有 v6 硬门自动 skip）；
   *         调度 `call_script_normalizer_v2.mjs`（产物多出 KVA / structure_hints / dialogue_char_count）。
   *   - dry-run / skip-editmap 时跳过（没有 LLM 或已有成品 edit_map）；
   *   - 失败时按 SD2_NORMALIZER_FALLBACK 环境变量决定降级/退出。
   */
  const normalizerExplicitOff = args['no-normalizer'] === true;
  const enableNormalizer =
    !dryRun && !skipEditmap &&
    (
      (sd2Version === 'v5' && Boolean(args.normalizer)) ||
      (sd2Version === 'v6' && !normalizerExplicitOff)
    );
  let normalizerArtifactPath = '';
  if (enableNormalizer) {
    const normalizerScript =
      sd2Version === 'v6' ? 'call_script_normalizer_v2.mjs' : 'call_script_normalizer_v1.mjs';
    console.log(
      `[run_sd2_pipeline] Stage 0 · ScriptNormalizer（${sd2Version === 'v6' ? 'v2 默认开启' : 'v1 opt-in'}）…`,
    );
    /** @type {string[]} */
    const stage0Args = [
      path.join('scripts', 'sd2_pipeline', normalizerScript),
      '--input',
      editMapInput,
      '--output',
      normalizerOut,
    ];
    if (typeof args['normalizer-prompt'] === 'string') {
      stage0Args.push(
        '--prompt-file',
        path.resolve(process.cwd(), args['normalizer-prompt']),
      );
    }
    /**
     * Stage 0 固定走 DashScope（lib/llm_client · SD2_LLM_MODEL，如 qwen-plus），与 EditMap 云雾 Opus 解耦。
     * 需要 Stage 0 也走云雾时，可显式 env SD2_NORMALIZER_USE_YUNWU=1（见下方）。
     */
    if (process.env.SD2_NORMALIZER_USE_YUNWU === '1' && useYunwu) {
      stage0Args.push('--yunwu');
    }
    if (args['no-thinking'] === true) {
      stage0Args.push('--no-thinking');
    }
    // ── v5.0 HOTFIX · H6：Stage 0 失败不再自动降级 ──
    //   原方案：try/catch 吞掉异常 → EditMap 按原 v5 行为跑（00 计划 §九 兜底）。
    //   新方案：Stage 0 是用户显式 opt-in 的能力（--normalizer），一旦失败，
    //          应当让 pipeline 直接非零退出，而不是悄悄走回原 v5 路径。
    //          原因：v5d 的日志显示降级之后 EditMap 拿到的还是原输入，
    //               导致 "stage0 on / stage0 off" 的产物看起来差不多，失败被淹没。
    //   如果确实希望容忍 Stage 0 失败（例如 CI 灰度阶段），请取消 --normalizer
    //   或者显式把 SD2_NORMALIZER_FALLBACK=1 设上（仅作为临时逃生口）。
    try {
      runNode(stage0Args);
      if (fs.existsSync(normalizerOut)) {
        normalizerArtifactPath = normalizerOut;
        console.log(
          `[run_sd2_pipeline] Stage 0 产物就绪，将透传给 EditMap：${normalizerOut}`,
        );
      } else {
        const msg = `[run_sd2_pipeline] Stage 0 完成但产物未找到 (${normalizerOut})`;
        if (process.env.SD2_NORMALIZER_FALLBACK === '1') {
          console.warn(`${msg} — SD2_NORMALIZER_FALLBACK=1 生效，按原 v5 行为继续。`);
        } else {
          console.error(`${msg}。请检查 ScriptNormalizer-v1.md 或 --model 参数后重试。`);
          process.exit(8);
        }
      }
    } catch (err) {
      const msg = `[run_sd2_pipeline] Stage 0 失败：${err instanceof Error ? err.message : err}`;
      if (process.env.SD2_NORMALIZER_FALLBACK === '1') {
        console.warn(`${msg} — SD2_NORMALIZER_FALLBACK=1 生效，按原 v5 行为继续。`);
      } else {
        console.error(
          `${msg}\n  → pipeline 非零退出（不降级）。常见原因：Yunwu 模型配额/限流、prompt 未同步、LLM 输出非合法 JSON。\n  → 紧急兜底：重跑时追加 env SD2_NORMALIZER_FALLBACK=1（仅临时使用）。`,
        );
        process.exit(9);
      }
    }
  } else if (Boolean(args.normalizer) && sd2Version !== 'v5' && sd2Version !== 'v6') {
    console.warn(
      `[run_sd2_pipeline] --normalizer 仅在 --sd2-version v5/v6 下生效（当前 ${sd2Version}），已忽略。`,
    );
  } else if (sd2Version === 'v6' && normalizerExplicitOff) {
    console.warn(
      '[run_sd2_pipeline] v6 --no-normalizer：Stage 0 已跳过。scriptChunk/KVA/对白保真等 v6 硬门将自动 skip（降级到 v5 行为）。',
    );
  }

  // ── v6.1 HOTFIX · Stage 0 产物自动挂载（真相源复用） ──
  //   背景：当 --skip-editmap / --no-normalizer / --dry-run 导致 enableNormalizer=false
  //        时，即使 output-dir 下已有 normalized_script_package.json（上一轮遗留），
  //        pipeline 也不会把它透传给 EditMap / Director payload / block_chain，
  //        下游 scriptChunk 全空 → director_kva_coverage=skip → Prompter 自检
  //        在无参照物情况下写出 raw_text="" 的假阳性 pass。
  //   修复：Stage 0 block 结束后，若 normalizerArtifactPath 仍空但 normalizerOut
  //        文件实际存在，自动挂载。这样 --skip-editmap 二跑或外部预生成 Stage 0
  //        的场景都能保留 v6 真相源，所有下游硬门按真实状态判定。
  //   边界：Stage 0 实跑失败会在上方 process.exit(8/9) 直接退出；真正走到这里的
  //        三种路径（未跑 / 成功 / 产物找不到）都已被明确处理，不会误挂其他版本产物。
  if (sd2Version === 'v6' && !normalizerArtifactPath && fs.existsSync(normalizerOut)) {
    normalizerArtifactPath = normalizerOut;
    console.log(
      `[run_sd2_pipeline] Stage 0 未实跑，自动挂载既有产物：${normalizerOut}（如需刷新请删除后重跑）`,
    );
  }

  if (!skipEditmap) {
    /**
     * EditMap 脚本路由：v6/v5/v4/v3/v2 各有一份；每份再细分云雾（Yunwu/Opus）和 DashScope。
     * v6 暂不提供 Yunwu 版本（LLM 端统一 DashScope，通过下游 `--downstream-model` 切换）。
     */
    if (sd2Version === 'v6' && useYunwu) {
      console.warn(
        '[run_sd2_pipeline] v6 EditMap 暂未提供云雾版本，自动回退到 DashScope（call_editmap_sd2_v6.mjs）。',
      );
    }
    const editMapScript =
      sd2Version === 'v6'
        ? 'call_editmap_sd2_v6.mjs'
        : sd2Version === 'v5'
          ? useYunwu
            ? 'call_yunwu_editmap_sd2_v5.mjs'
            : 'call_editmap_sd2_v5.mjs'
          : sd2Version === 'v4'
            ? useYunwu
              ? 'call_yunwu_editmap_sd2_v4.mjs'
              : 'call_editmap_sd2_v4.mjs'
            : sd2Version === 'v3'
              ? useYunwu
                ? 'call_yunwu_editmap_sd2_v3.mjs'
                : 'call_editmap_sd2_v3.mjs'
              : useYunwu
                ? 'call_yunwu_editmap_sd2.mjs'
                : 'call_editmap_sd2.mjs';
    console.log(
      `[run_sd2_pipeline] LLM 生成 edit_map_sd2.json（${sd2Version}，${useYunwu ? 'Yunwu/Opus' : 'DashScope'}）…`,
    );
    /** @type {string[]} */
    const emArgs = [
      path.join('scripts', 'sd2_pipeline', editMapScript),
      '--input',
      editMapInput,
      '--output',
      editMapOut,
    ];
    if (typeof args.model === 'string') {
      emArgs.push('--model', args.model);
    }
    if (args['no-thinking'] === true) {
      emArgs.push('--no-thinking');
    }
    /**
     * Stage 0 → EditMap 产物桥接（v5/v6）：
     * v5 透传是 opt-in，v6 默认透传（scriptChunk/KVA 依赖它）；缺失时 EditMap 自动退回 v5 行为。
     */
    if ((sd2Version === 'v5' || sd2Version === 'v6') && normalizerArtifactPath) {
      emArgs.push('--normalized-package', normalizerArtifactPath);
    }
    // HOTFIX D/G · v6 EditMap 层硬门降级 flag 透传（与下游 block chain 同名）：
    //   --allow-v6-soft：一键降级
    //   --skip-editmap-coverage-hard：仅 segment_coverage_l1 降级
    //   --skip-last-seg-hard：仅 last_seg_covered_check 降级
    //   --skip-source-integrity-hard：仅 source_integrity_check 降级（HOTFIX G）
    if (sd2Version === 'v6') {
      for (const flag of [
        'allow-v6-soft',
        'skip-editmap-coverage-hard',
        'skip-last-seg-hard',
        'skip-source-integrity-hard',
      ]) {
        if (args[flag] === true) emArgs.push(`--${flag}`);
      }
    }
    runNode(emArgs);
  } else if (!fs.existsSync(editMapOut)) {
    throw new Error(`skip-editmap 需要已有文件: ${editMapOut}`);
  }

  /** @type {unknown} */
  let editMapParsed = null;
  if (fs.existsSync(editMapOut)) {
    try {
      editMapParsed = JSON.parse(fs.readFileSync(editMapOut, 'utf8'));
    } catch {
      editMapParsed = null;
    }
  }
  const { renderingStyle, artStyle } = resolveSd2StyleHints({
    cliRenderingStyle: renderingStyleCli,
    cliArtStyle: artStyleCli,
    editMapJsonPath: editMapOut,
    editMap: editMapParsed,
  });
  console.log(
    `[run_sd2_pipeline] 画面风格: renderingStyle=${renderingStyle}；artStyle=${artStyle}`,
  );

  const blockOnly = typeof args.block === 'string' ? args.block : '';

  /** Block 内 Director→Prompter 串联 + Block 间错峰并发（默认走此路径，除非 skip-prompter 或 skip-director 需旧两阶段） */
  const useBlockChain = !dryRun && !skipDirector && !skipPrompter;

  /**
   * aspect ratio 解析：
   * - CLI 显式传 --aspect-ratio 最优先；
   * - v5 分支若 CLI 未传，尝试从 editMap.meta.video.aspect_ratio 回退；
   * - 其它版本 / 兜底：16:9。
   */
  const metaVideoAspect =
    editMapParsed &&
    typeof editMapParsed === 'object' &&
    /** @type {Record<string, unknown>} */ (editMapParsed).meta &&
    typeof /** @type {{ meta: unknown }} */ (editMapParsed).meta === 'object'
      ? (() => {
          const m = /** @type {Record<string, unknown>} */ (
            /** @type {{ meta: Record<string, unknown> }} */ (editMapParsed).meta
          );
          const v = m.video && typeof m.video === 'object' ? /** @type {Record<string, unknown>} */ (m.video) : {};
          return typeof v.aspect_ratio === 'string' ? v.aspect_ratio : '';
        })()
      : '';
  const aspectRatioArg =
    typeof args['aspect-ratio'] === 'string' && args['aspect-ratio'].trim()
      ? args['aspect-ratio'].trim()
      : sd2Version === 'v5' && metaVideoAspect
        ? metaVideoAspect
        : '16:9';

  if (!dryRun && !skipDirector) {
    console.log('[run_sd2_pipeline] 构建 sd2_director_payloads.json …');
    if (sd2Version === 'v6') {
      const editMapForPayload = JSON.parse(fs.readFileSync(editMapOut, 'utf8'));
      /** @type {unknown} */
      let normalizedPackageForPayload = null;
      if (normalizerArtifactPath && fs.existsSync(normalizerArtifactPath)) {
        try {
          normalizedPackageForPayload = JSON.parse(
            fs.readFileSync(normalizerArtifactPath, 'utf8'),
          );
        } catch (err) {
          console.warn(
            `[run_sd2_pipeline] v6 payload 构造：读取 ${normalizerArtifactPath} 失败：${err instanceof Error ? err.message : err}`,
          );
        }
      }
      const data = buildAllDirectorPayloadsV6({
        editMap: editMapForPayload,
        normalizedScriptPackage: normalizedPackageForPayload,
        kbDir: kbDirRel,
        renderingStyle,
        aspectRatio: aspectRatioArg,
        maxExamples: 2,
      });
      fs.writeFileSync(directorPayloads, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } else if (sd2Version === 'v5') {
      // v5：编排层直接构造（含 v5Meta 透传），再由 block_chain_v5 按需叠加 knowledge_slices
      const editMapForPayload = JSON.parse(fs.readFileSync(editMapOut, 'utf8'));
      const data = buildAllDirectorPayloadsV5({
        editMap: editMapForPayload,
        kbDir: kbDirRel,
        renderingStyle,
        aspectRatio: aspectRatioArg,
        maxExamples: 2,
      });
      fs.writeFileSync(directorPayloads, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } else if (sd2Version === 'v4') {
      const editMapForPayload = JSON.parse(fs.readFileSync(editMapOut, 'utf8'));
      const data = buildAllDirectorPayloadsV4({
        editMap: editMapForPayload,
        kbDir: kbDirRel,
        renderingStyle,
        aspectRatio: aspectRatioArg,
        maxExamples: 2,
      });
      fs.writeFileSync(directorPayloads, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } else if (sd2Version === 'v3') {
      const editMapForPayload = JSON.parse(fs.readFileSync(editMapOut, 'utf8'));
      const data = buildAllDirectorPayloadsV3({
        editMap: editMapForPayload,
        kbDir: kbDirRel,
        renderingStyle,
        aspectRatio: aspectRatioArg,
        maxExamples: 2,
      });
      fs.writeFileSync(directorPayloads, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } else {
      runNode([
        path.join('scripts', 'build_sd2_prompter_payload.js'),
        editMapOut,
        '--director-payloads-only',
        '--output',
        directorPayloads,
        '--rendering-style',
        renderingStyle,
        '--kb-dir',
        kbDirRel,
      ]);
    }
  } else if (skipDirector) {
    console.log('[run_sd2_pipeline] skip-director：跳过 SD2Director，payload 不含 sd2_director');
  }

  /**
   * v3/v4/v5 的 payload 结构与 v2 不兼容，跳过 build_sd2_prompter_payload.js（它是 v2 合并逻辑）。
   */
  const skipPayArgsMerge = isMdPipeline && (skipDirector || skipPrompter);

  if (useBlockChain) {
    console.log(
      '[run_sd2_pipeline] 各 Block 内 Director→Prompter 串联；Block 间全 fan-out 并发（v5.0-rev7 · 默认解锁 scene_run_id 串行）…',
    );
    // HOTFIX J · v6 后端切换：
    //   --block-chain-backend=doubao 会把 Stage 2/3 的 LLM 后端切到火山豆包 Ark
    //   （独立入口 call_sd2_block_chain_v6_doubao.mjs，复用 v6 主脚本的 main()）。
    //   默认值 'default' 保持 DashScope/云雾路径不变。
    const blockChainBackend =
      typeof args['block-chain-backend'] === 'string' && args['block-chain-backend'].trim()
        ? args['block-chain-backend'].trim()
        : 'default';
    const useDoubaoBackend = sd2Version === 'v6' && blockChainBackend === 'doubao';
    const chainScript =
      useDoubaoBackend
        ? 'call_sd2_block_chain_v6_doubao.mjs'
        : sd2Version === 'v6'
          ? 'call_sd2_block_chain_v6.mjs'
          : sd2Version === 'v5'
            ? 'call_sd2_block_chain_v5.mjs'
            : sd2Version === 'v4'
              ? 'call_sd2_block_chain_v4.mjs'
              : sd2Version === 'v3'
                ? 'call_sd2_block_chain_v3.mjs'
                : 'call_sd2_block_chain.mjs';
    if (useDoubaoBackend) {
      console.log(
        '[run_sd2_pipeline] HOTFIX J · Stage 2/3 后端切换至豆包（call_sd2_block_chain_v6_doubao.mjs）。' +
          '需要 ARK_API_KEY（或显式设置 SD2_LLM_*，优先级更高）。',
      );
    }
    /** @type {string[]} */
    const chainArgs = [
      path.join('scripts', 'sd2_pipeline', chainScript),
      '--edit-map',
      editMapOut,
      '--director-payloads',
      directorPayloads,
      '--out-root',
      outRoot,
      '--rendering-style',
      renderingStyle,
      '--art-style',
      artStyle,
      '--stagger-ms',
      staggerMsArg,
      '--kb-dir',
      path.join(REPO_ROOT, kbDirRel),
      '--aspect-ratio',
      aspectRatioArg,
    ];
    if (blockOnly) {
      chainArgs.push('--block', blockOnly);
    }
    if (prompterPromptArg) {
      chainArgs.push(
        '--prompter-prompt',
        path.resolve(process.cwd(), prompterPromptArg),
      );
    }
    if (sd2Version === 'v6') {
      // v6 专用：把 Stage 0 产物路径透传给 block chain，用于 scriptChunk 重建 + 对白保真硬门
      if (normalizerArtifactPath) {
        chainArgs.push('--normalized-package', normalizerArtifactPath);
      }
      // 一键降级 flag（与 v6 Prompt CLI 同名）
      for (const flag of [
        'allow-v6-soft',
        'skip-kva-hard',
        'skip-segment-coverage-hard',
        'skip-info-density-hard',
        'skip-dialogue-fidelity-hard',
        'skip-prompter-selfcheck-hard',
        'skip-style-inference',
      ]) {
        if (args[flag] === true) chainArgs.push(`--${flag}`);
      }
    }
    runNode(chainArgs);
  } else {
    if (!dryRun && !skipDirector && skipPrompter) {
      console.log('[run_sd2_pipeline] LLM SD2Director（仅导演，随后写 payload，不跑 Prompter）…');
      const directorScript =
        sd2Version === 'v5'
          ? 'call_sd2_director_v5.mjs'
          : sd2Version === 'v4'
            ? 'call_sd2_director_v4.mjs'
            : sd2Version === 'v3'
              ? 'call_sd2_director_v3.mjs'
              : 'call_sd2_director.mjs';
      runNode([
        path.join('scripts', 'sd2_pipeline', directorScript),
        '--payloads',
        directorPayloads,
        '--out-dir',
        directorPromptsDir,
      ]);
    }
    if (!skipPayArgsMerge) {
      console.log('[run_sd2_pipeline] 运行 build_sd2_prompter_payload.js（合并 Prompter 输入）…');
      /** @type {string[]} */
      const payArgs = [
        path.join('scripts', 'build_sd2_prompter_payload.js'),
        editMapOut,
        '--rendering-style',
        renderingStyle,
        '--art-style',
        artStyle,
        '--output',
        payloadsOut,
        '--kb-dir',
        kbDirRel,
      ];
      if (!dryRun && !skipDirector && fs.existsSync(directorAll)) {
        payArgs.push('--director-json', directorAll);
      }
      runNode(payArgs);
    } else if (isMdPipeline) {
      console.log(
        `[run_sd2_pipeline] ${sd2Version}：已跳过 build_sd2_prompter_payload（与 v2 合并字段不兼容，请用默认 Block 链或仅 EditMap）`,
      );
    }
  }

  if (dryRun) {
    console.log('[run_sd2_pipeline] dry-run：跳过 SD2Director 与 SD2Prompter LLM');
    console.log(`[run_sd2_pipeline] 完成。产物目录: ${outRoot}`);
    return;
  }

  if (skipPrompter) {
    console.log(
      '[run_sd2_pipeline] skip-prompter：跳过 SD2Prompter 与 sd2_final_report，不覆盖最终提示词',
    );
    console.log(`[run_sd2_pipeline] 完成。产物目录: ${outRoot}`);
    return;
  }

  if (!useBlockChain) {
    console.log('[run_sd2_pipeline] LLM 生成各 Block 三段式提示词（分阶段并发）…');
    const prompterScript =
      sd2Version === 'v5'
        ? 'call_sd2_prompter_v5.mjs'
        : sd2Version === 'v4'
          ? 'call_sd2_prompter_v4.mjs'
          : sd2Version === 'v3'
            ? 'call_sd2_prompter_v3.mjs'
            : 'call_sd2_prompter.mjs';
    /** @type {string[]} */
    const proArgs = [
      path.join('scripts', 'sd2_pipeline', prompterScript),
      '--payloads',
      payloadsOut,
      '--out-dir',
      promptsDir,
    ];
    if (typeof args.concurrency === 'string' && args.concurrency !== '') {
      proArgs.push('--concurrency', args.concurrency);
    }
    proArgs.push('--stagger-ms', staggerMsArg);
    if (blockOnly) {
      proArgs.push('--block', blockOnly);
    }
    if (prompterPromptArg) {
      proArgs.push(
        '--prompt-file',
        path.resolve(process.cwd(), prompterPromptArg),
      );
    }
    runNode(proArgs);
  }

  console.log('[run_sd2_pipeline] 汇总每 Block 最终 prompt 与资产 …');
  runNode([
    path.join('scripts', 'sd2_pipeline', 'export_sd2_final_report.mjs'),
    '--sd2-dir',
    outRoot,
  ]);

  console.log(`[run_sd2_pipeline] 全部完成: ${outRoot}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[run_sd2_pipeline]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
