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
 * --sd2-version v2|v3|v4：v3/v4 使用 Markdown+appendix 管线；v4 另含知识切片注入与 continuity（见 SD2Workflow-v4-接入指南.md）（默认 v2）。
 * --edit-map-input <path>：直接复制为输出目录下的 edit_map_input.json，跳过 prepare_editmap_input（可与 --episode-json 同用）。
 * --yunwu：EditMap 第一步走云雾（默认 YUNWU_MODEL=Opus 等），Director/Prompter 仍走 SD2_LLM_*。
 *           传 --yunwu 时若未设 --downstream-model，自动将本进程 SD2_LLM_MODEL=qwen-plus，避免与 Opus 混用同 env。
 * --downstream-model <id>：显式指定 Director / Prompter / Block 链用的模型（写入 SD2_LLM_MODEL），例如 qwen-plus、qwen-turbo。
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { resolveSd2StyleHints } from './lib/edit_map_style_hints.mjs';
import { buildAllDirectorPayloadsV3 } from './lib/sd2_v3_payloads.mjs';
import { buildAllDirectorPayloadsV4 } from './lib/sd2_v4_payloads.mjs';

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
    sd2VersionRaw === 'v4' ? 'v4' : sd2VersionRaw === 'v3' ? 'v3' : 'v2';

  if ((sd2Version === 'v3' || sd2Version === 'v4') && skipDirector && !skipPrompter) {
    throw new Error(
      'SD2 v3/v4 不支持仅跳过 Director 仍跑 Prompter；请去掉 --skip-director 或加上 --skip-prompter',
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
  if (shotHintArg) {
    prepArgs.push('--shot-hint', shotHintArg);
  }
  if (motionBiasArg) {
    prepArgs.push('--motion-bias', motionBiasArg);
  }
  if (genreArg) {
    prepArgs.push('--genre', genreArg);
  }
  if (targetBlockCountArg) {
    prepArgs.push('--target-block-count', targetBlockCountArg);
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

  if (!skipEditmap) {
    const editMapScript =
      sd2Version === 'v4'
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

  const aspectRatioArg =
    typeof args['aspect-ratio'] === 'string' && args['aspect-ratio'].trim()
      ? args['aspect-ratio'].trim()
      : '16:9';

  if (!dryRun && !skipDirector) {
    console.log('[run_sd2_pipeline] 构建 sd2_director_payloads.json …');
    if (sd2Version === 'v4') {
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

  const skipPayArgsMerge =
    (sd2Version === 'v3' || sd2Version === 'v4') && (skipDirector || skipPrompter);

  if (useBlockChain) {
    console.log(
      '[run_sd2_pipeline] 各 Block 内 Director→Prompter 串联；Block 间错峰并发（stagger-ms）…',
    );
    const chainScript =
      sd2Version === 'v4'
        ? 'call_sd2_block_chain_v4.mjs'
        : sd2Version === 'v3'
          ? 'call_sd2_block_chain_v3.mjs'
          : 'call_sd2_block_chain.mjs';
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
    runNode(chainArgs);
  } else {
    if (!dryRun && !skipDirector && skipPrompter) {
      console.log('[run_sd2_pipeline] LLM SD2Director（仅导演，随后写 payload，不跑 Prompter）…');
      const directorScript =
        sd2Version === 'v4'
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
    } else if (sd2Version === 'v3' || sd2Version === 'v4') {
      console.log(
        '[run_sd2_pipeline] v3/v4：已跳过 build_sd2_prompter_payload（与 v2 合并字段不兼容，请用默认 Block 链或仅 EditMap）',
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
      sd2Version === 'v4'
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
