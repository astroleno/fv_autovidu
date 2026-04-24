#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

import {
  checkFullPromptsV7,
  writeFullPromptsV7,
} from './lib/prompt_full_builder_v7.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
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

const args = parseArgs(process.argv.slice(2));
const promptRoot = typeof args['prompt-root'] === 'string' ? path.resolve(args['prompt-root']) : undefined;

if (args.write === true) {
  const manifest = writeFullPromptsV7({ promptRoot });
  const manifestPath = path.join(manifest.prompt_root, 'prompt_manifest_v7.generated.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        workflow: manifest.workflow,
        generated_at: manifest.generated_at,
        prompts: manifest.prompts.map(({ content: _content, ...rest }) => rest),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`[build_full_prompts_v7] wrote ${manifest.prompts.length} generated prompts`);
  console.log(`[build_full_prompts_v7] manifest ${manifestPath}`);
  process.exit(0);
}

if (args.check === true) {
  const result = checkFullPromptsV7({ promptRoot });
  if (result.ok) {
    console.log('[build_full_prompts_v7] generated prompts are up to date');
    process.exit(0);
  }
  console.error('[build_full_prompts_v7] generated prompts are out of date:');
  for (const diff of result.diffs) {
    console.error(`  - ${diff.id}: ${diff.reason} (${diff.output})`);
  }
  process.exit(1);
}

console.error('Usage: node scripts/sd2_pipeline/build_full_prompts_v7.mjs --write|--check [--prompt-root <dir>]');
process.exit(2);
