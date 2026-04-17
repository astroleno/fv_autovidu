#!/usr/bin/env node
/**
 * 把仓库根 prompt/1_SD2Workflow/ 同步到 skill 内部 prompts/ 副本。
 *
 * 用法：
 *   node skills/generating-sd2-storyboards/scripts/sync-from-repo.mjs [--bump patch|minor|major] [--note "<说明>"] [--dry-run] [--yes]
 *
 * 默认行为：
 *   - --bump 未传：patch（修订号 +1）
 *   - --note 未传：自动写 "manual sync"
 *   - 默认交互确认；加 --yes 跳过
 *   - --dry-run 只预览 diff，不实际改文件
 *
 * 工作步骤：
 *   1. diff 对比仓库根与 skill 副本（忽略 _deprecated/ 与元数据文件）
 *   2. 列出将变更的文件，确认
 *   3. 复制源文件覆盖目标（保持 _deprecated/ 不动）
 *   4. bump VERSION
 *   5. append CHANGELOG.md 一条新记录
 *
 * 退出码：0 成功 / 1 同步失败 / 2 参数非法 / 3 用户中断
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根：本脚本回溯 3 层 */
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
/** 同步源：仓库根 prompt/1_SD2Workflow */
const SRC_ROOT = path.join(REPO_ROOT, 'prompt', '1_SD2Workflow');
/** 同步目标：skill 自带 prompts 副本 */
const DST_ROOT = path.resolve(SCRIPT_DIR, '..', 'prompts');
/** 不参与 sync 的 DST 侧顶层路径（skill 独有的元数据/归档，sync 不能碰） */
const DST_IGNORE = new Set(['_deprecated', 'VERSION', 'CHANGELOG.md', 'README.md', 'KNOWLEDGE_GRAPH.md', 'CONSUMERS.md']);

/** 不从 SRC 拉取的顶层路径（v4 流水线不再消费，强行同步反而污染 DST） */
const SRC_IGNORE = new Set(['3_FewShotKnowledgeBase']);

/** @param {string} msg @param {'info'|'err'|'warn'} [level] */
const log = (msg, level = 'info') => {
  const line = `[sync-from-repo] ${msg}`;
  if (level === 'err') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

/**
 * 解析 `--key value` / `--flag` 形式 argv。
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgv(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out[key] = 'true'; }
    else { out[key] = next; i += 1; }
  }
  return out;
}

/**
 * 递归列出目录下所有文件（相对 root 的 posix 路径数组）。
 * @param {string} root
 * @param {string} [rel]
 * @returns {string[]}
 */
function listFiles(root, rel = '') {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    const relPath = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(abs, name));
    if (st.isDirectory()) out.push(...listFiles(root, relPath));
    else out.push(relPath);
  }
  return out;
}

/**
 * 简易交互 y/N 确认；非 TTY 直接返回 false。
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

/**
 * 执行版本号 bump。
 * @param {string} current "major.minor.patch"
 * @param {'major'|'minor'|'patch'} kind
 * @returns {string}
 */
function bumpVersion(current, kind) {
  const m = current.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`VERSION 文件格式非法: ${current}`);
  let [, maj, min, pat] = m.map(Number);
  if (kind === 'major') { maj += 1; min = 0; pat = 0; }
  else if (kind === 'minor') { min += 1; pat = 0; }
  else { pat += 1; }
  return `${maj}.${min}.${pat}`;
}

/**
 * 计算两个目录（忽略 DST_IGNORE）的文件级差异。
 * @returns {{ add: string[], modify: string[], remove: string[] }}
 */
function computeDiff() {
  const srcFiles = new Set(listFiles(SRC_ROOT).filter(
    (rel) => !SRC_IGNORE.has(rel.split('/')[0]),
  ));
  const dstFiles = new Set(listFiles(DST_ROOT).filter(
    (rel) => !DST_IGNORE.has(rel.split('/')[0]),
  ));
  const add = [], modify = [], remove = [];
  for (const rel of srcFiles) {
    if (!dstFiles.has(rel)) { add.push(rel); continue; }
    const a = fs.readFileSync(path.join(SRC_ROOT, rel));
    const b = fs.readFileSync(path.join(DST_ROOT, rel));
    if (!a.equals(b)) modify.push(rel);
  }
  for (const rel of dstFiles) if (!srcFiles.has(rel)) remove.push(rel);
  return { add, modify, remove };
}

/** 应用 diff 到 DST_ROOT @param {ReturnType<typeof computeDiff>} diff */
function applyDiff(diff) {
  for (const rel of [...diff.add, ...diff.modify]) {
    const src = path.join(SRC_ROOT, rel);
    const dst = path.join(DST_ROOT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  for (const rel of diff.remove) {
    const dst = path.join(DST_ROOT, rel);
    if (fs.existsSync(dst)) fs.unlinkSync(dst);
  }
}

/**
 * 尝试获取当前仓库 HEAD 的 commit 短 hash；失败返回空串。
 * @returns {string}
 */
function getSourceCommit() {
  try { return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim(); }
  catch { return ''; }
}

/**
 * 在 CHANGELOG.md 顶部（第一个 `## [` 之前）插入新条目。
 * @param {{ version: string, diff: ReturnType<typeof computeDiff>, note: string, commit: string }} args
 */
function appendChangelog(args) {
  const changelogPath = path.join(DST_ROOT, 'CHANGELOG.md');
  const now = new Date().toISOString().slice(0, 10);
  const lines = [`## [${args.version}] - ${now}`, ''];
  if (args.commit) lines.push(`**来源 commit**: \`${args.commit}\``, '');
  lines.push(`**说明**: ${args.note}`, '', '**文件变更**:', '');
  if (args.diff.add.length) lines.push(...args.diff.add.map((f) => `- [add] ${f}`));
  if (args.diff.modify.length) lines.push(...args.diff.modify.map((f) => `- [mod] ${f}`));
  if (args.diff.remove.length) lines.push(...args.diff.remove.map((f) => `- [del] ${f}`));
  lines.push('', '---', '');

  const newEntry = lines.join('\n');
  const current = fs.readFileSync(changelogPath, 'utf8');
  const insertAt = current.indexOf('## [');
  const updated = insertAt < 0 ? current + '\n' + newEntry : current.slice(0, insertAt) + newEntry + current.slice(insertAt);
  fs.writeFileSync(changelogPath, updated);
}

async function main() {
  const raw = parseArgv(process.argv.slice(2));
  const bump = /** @type {'major'|'minor'|'patch'} */ (raw.bump || 'patch');
  if (!['major', 'minor', 'patch'].includes(bump)) {
    log(`--bump 只能是 major/minor/patch，收到: ${bump}`, 'err');
    process.exit(2);
  }
  const note = raw.note && raw.note !== 'true' ? raw.note : 'manual sync';
  const dryRun = raw['dry-run'] === 'true';
  const yes = raw.yes === 'true';

  if (!fs.existsSync(SRC_ROOT)) { log(`同步源不存在: ${SRC_ROOT}`, 'err'); process.exit(1); }
  if (!fs.existsSync(DST_ROOT)) { log(`同步目标不存在: ${DST_ROOT}`, 'err'); process.exit(1); }

  log(`源:   ${SRC_ROOT}`);
  log(`目标: ${DST_ROOT}`);

  const diff = computeDiff();
  const total = diff.add.length + diff.modify.length + diff.remove.length;
  if (total === 0) { log('已是最新，无需同步'); return; }

  log(`变更预览：+${diff.add.length} / ~${diff.modify.length} / -${diff.remove.length}`);
  for (const f of diff.add) log(`  [add] ${f}`);
  for (const f of diff.modify) log(`  [mod] ${f}`);
  for (const f of diff.remove) log(`  [del] ${f}`);

  if (dryRun) { log('dry-run 模式，仅预览，未实际改动'); return; }

  if (!yes && !(await confirm(`确认同步并 bump ${bump}？`))) {
    log('用户取消', 'warn');
    process.exit(3);
  }

  applyDiff(diff);
  const versionPath = path.join(DST_ROOT, 'VERSION');
  const currentVersion = fs.readFileSync(versionPath, 'utf8').trim();
  const nextVersion = bumpVersion(currentVersion, bump);
  fs.writeFileSync(versionPath, `${nextVersion}\n`);
  appendChangelog({ version: nextVersion, diff, note, commit: getSourceCommit() });

  log(`完成：v${currentVersion} → v${nextVersion}`);
  log(`CHANGELOG 已追加；请 git diff 核对后 commit`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { log(e instanceof Error ? e.stack || e.message : String(e), 'err'); process.exit(1); });
}
