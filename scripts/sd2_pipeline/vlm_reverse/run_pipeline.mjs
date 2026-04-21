/**
 * 入口：串联子命令。
 *
 *   node scripts/sd2_pipeline/vlm_reverse/run_pipeline.mjs manifest
 *   node scripts/sd2_pipeline/vlm_reverse/run_pipeline.mjs compare
 *   node scripts/sd2_pipeline/vlm_reverse/run_pipeline.mjs batch
 *   node scripts/sd2_pipeline/vlm_reverse/run_pipeline.mjs aggregate [raw/batch子目录]
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function run(scriptName, extraArgs = []) {
  const script = path.join(__dirname, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn(node, [script, ...extraArgs], {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..', '..', '..'),
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptName} 退出码 ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  const cmd = process.argv[2] || 'help';
  if (cmd === 'manifest' || cmd === 'filter') {
    await run('filter_segments.mjs');
    return;
  }
  if (cmd === 'compare' || cmd === 'ab') {
    await run('filter_segments.mjs');
    await run('vlm_model_compare.mjs');
    return;
  }
  if (cmd === 'batch') {
    await run('vlm_batch_segments.mjs');
    return;
  }
  if (cmd === 'aggregate') {
    const rest = process.argv.slice(3);
    await run('aggregate_outputs.mjs', rest);
    return;
  }
  console.log(`用法:
  node run_pipeline.mjs manifest   # 仅生成 segments_manifest.json
  node run_pipeline.mjs compare    # manifest + A/B 三片段双模型
  node run_pipeline.mjs batch      # 全量（需 VLM_GEMINI_MODEL）
  node run_pipeline.mjs aggregate [raw/batch路径]`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
