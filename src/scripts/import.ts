import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { QuestionItem as Item, describeIssues } from '../services/questionTemplate.js';
import { saveQuestion } from '../services/questionAdmin.js';
import { sql } from '../db/client.js';

/**
 * Usage:  npm run import -- data/questions/sample.json [--approve]
 * - Upserts by external_id (safe to re-run; edits bump `version`).
 * - Without --approve questions land as pending_review and are NOT served to students.
 */
async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) throw new Error('Usage: npm run import -- <file.json> [--approve]');
  const approve = flags.includes('--approve');

  const raw = JSON.parse(await readFile(file, 'utf8'));
  const items = z.array(z.unknown()).parse(raw);

  let ok = 0;
  const failed: string[] = [];
  for (const [i, item] of items.entries()) {
    const p = Item.safeParse(item);
    if (!p.success) {
      failed.push(`#${i}: ${describeIssues(p.error).join('; ')}`);
      continue;
    }
    const r = await saveQuestion(p.data, { approve, source: 'import' });
    if ('error' in r) failed.push(`#${i}: ${r.error}`);
    else ok++;
  }

  console.log(`Imported ${ok}/${items.length} questions (${approve ? 'approved' : 'pending_review'}).`);
  if (failed.length) {
    console.error(`Failed ${failed.length}:\n${failed.join('\n')}`);
    process.exitCode = 1;
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

