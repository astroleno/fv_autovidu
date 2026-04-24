import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  buildFullPromptManifestV7,
  checkFullPromptsV7,
  writeFullPromptsV7,
} from '../lib/prompt_full_builder_v7.mjs';

let passed = 0;
let failed = 0;

function assert(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`, extra ?? '');
  }
}

function writeFile(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd2-full-prompts-'));
for (const rel of [
  '0_ScriptNormalizer/ScriptNormalizer-v2.md',
  '1_EditMap-SD2/1_EditMap-v7.md',
  '1_EditMap-SD2/1_EditMap-Translator-v1.md',
  '1_5_SceneArchitect/1_5_SceneArchitect-v1.md',
  '2_SD2Director/2_SD2Director-v6.md',
  '2_SD2Prompter/2_SD2Prompter-v6.md',
]) {
  writeFile(tmp, rel, `# Role\nbase prompt for ${rel}\n# Input\n# Output\n# Hard Rules\n`);
}
writeFile(tmp, '4_KnowledgeSlices/editmap/a.md', 'editmap slice');
writeFile(tmp, '4_KnowledgeSlices/director/a.md', 'director slice');
writeFile(tmp, '4_KnowledgeSlices/prompter/a.md', 'prompter slice');

console.log('-- buildFullPromptManifestV7');
{
  const manifest = buildFullPromptManifestV7({ promptRoot: tmp, generatedAt: '2026-04-24T00:00:00.000Z' });
  assert('manifest has six prompt targets', manifest.prompts.length === 6, manifest.prompts.map((x) => x.id));
  assert('each prompt has sha256 hash', manifest.prompts.every((x) => /^sha256:[a-f0-9]{64}$/.test(x.prompt_hash)), manifest.prompts);
  assert('generated content has do-not-edit header', manifest.prompts.every((x) => x.content.includes('GENERATED FILE. DO NOT EDIT DIRECTLY.')));
  assert('generated content has untrusted input boundary', manifest.prompts.every((x) => x.content.includes('Untrusted Input Boundary')));
}

console.log('-- writeFullPromptsV7 / checkFullPromptsV7');
{
  const writeResult = writeFullPromptsV7({ promptRoot: tmp, generatedAt: '2026-04-24T00:00:00.000Z' });
  assert('write creates generated prompt files', writeResult.prompts.every((x) => fs.existsSync(x.output_abs)), writeResult.prompts);
  const clean = checkFullPromptsV7({ promptRoot: tmp });
  assert('check passes immediately after write', clean.ok === true, clean.diffs);
  fs.appendFileSync(path.join(tmp, '2_SD2Director', '2_SD2Director-v6.md'), '\nsource changed\n');
  const dirty = checkFullPromptsV7({ promptRoot: tmp });
  assert('check fails after source changes', dirty.ok === false && dirty.diffs.some((x) => x.id === 'director_v6'), dirty.diffs);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
