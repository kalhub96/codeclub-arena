import { randomBytes } from 'node:crypto';
import { eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { languages, questions } from '../db/schema.js';
import { defaultReward } from './xp.js';
import type { QuestionInput } from './questionTemplate.js';

/** Insert or update (by external_id). Returns the question id, or an error for the admin. */
export async function saveQuestion(
  q: QuestionInput,
  opts: { approve: boolean; source: string },
): Promise<{ id: number; language: string } | { error: string }> {
  const langs = await db.select().from(languages);
  const lang = langs.find((l) => l.name.toLowerCase() === q.language.trim().toLowerCase());
  if (!lang) return { error: `Unknown language "${q.language}". Available: ${langs.map((l) => l.name).join(', ')}.` };

  const values = {
    externalId: q.external_id ?? `${opts.source}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    languageId: lang.id,
    difficulty: q.difficulty,
    prompt: q.prompt,
    options: q.options,
    answerKey: q.answer,
    hints: q.hints,
    conceptTip: q.concept_tip,
    snippet: q.snippet,
    snippetLang: q.snippet_lang,
    integrationNote: q.integration_note,
    xpReward: q.xp_reward ?? defaultReward(q.difficulty),
    status: opts.approve ? ('approved' as const) : ('pending_review' as const),
    source: opts.source,
  };
  const [row] = await db
    .insert(questions)
    .values(values)
    .onConflictDoUpdate({ target: questions.externalId, set: { ...values, version: dsql`${questions.version} + 1` } })
    .returning({ id: questions.id });
  return { id: row!.id, language: lang.name };
}

/** Soft delete: students' history stays valid, the question is no longer served. */
export async function retireQuestion(id: number) {
  const [row] = await db
    .update(questions)
    .set({ status: 'retired' })
    .where(eq(questions.id, id))
    .returning({ id: questions.id, prompt: questions.prompt, language: questions.languageId });
  return row ?? null;
}
