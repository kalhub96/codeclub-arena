import { z } from 'zod';

/** One question, as accepted from JSON files, the import script and the /addquestion template. */
export const QuestionItem = z
  .object({
    external_id: z.string().min(3).optional(),
    language: z.string().min(1),
    difficulty: z.number().int().min(1).max(6),
    prompt: z.string().min(5),
    options: z.array(z.string().min(1)).min(2).max(6),
    answer: z.string().min(1),
    hints: z.array(z.string().min(1)).max(3).default([]),
    concept_tip: z.string().default(''),
    snippet: z.string().min(1, 'the code example is required'),
    snippet_lang: z.string().default('text'),
    integration_note: z.string().default(''),
    xp_reward: z.number().int().min(1).max(500).optional(),
  })
  .refine((q) => q.options.includes(q.answer), { message: 'the correct answer must match one of the options' })
  .refine((q) => new Set(q.options).size === q.options.length, { message: 'options must all be different' });

export type QuestionInput = z.infer<typeof QuestionItem>;

export const TEMPLATE = `language: HTML
level: 1
question: Which tag creates the largest heading?
options:
+ <h1>
- <h6>
- <head>
- <header>
hint: Heading tags are numbered.
hint: Think of 1 as the most important.
tip: HTML has six heading levels, h1 is the biggest.
code: html
<main>
  <h1>My page</h1>
</main>
note: Use one h1 per page.`;

const KEY = /^(language|level|question|options|hint|tip|code|note|xp)\s*:\s*(.*)$/i;

/** Parses the line-based template. Returns the item, or readable problems to show the admin. */
export function parseTemplate(raw: string): { item?: unknown; errors: string[] } {
  const errors: string[] = [];
  const lines = raw.replace(/\r/g, '').split('\n');
  if (/^\/addquestion(@\w+)?\s*$/i.test((lines[0] ?? '').trim())) lines.shift();
  else if (/^\/addquestion(@\w+)?\s/i.test(lines[0] ?? '')) lines[0] = lines[0]!.replace(/^\/addquestion(@\w+)?\s+/i, '');

  const f: { language?: string; level?: string; question?: string; tip?: string; note?: string; xp?: string; lang?: string } = {};
  const hints: string[] = [];
  const options: string[] = [];
  let answer: string | undefined;
  const correct: string[] = [];
  let code: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = KEY.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === 'options') {
      while (i + 1 < lines.length && /^\s*[+\-*]\s+\S/.test(lines[i + 1]!)) {
        const o = /^\s*([+\-*])\s+(.*\S)\s*$/.exec(lines[++i]!)!;
        options.push(o[2]!);
        if (o[1] === '+') correct.push(o[2]!);
      }
    } else if (key === 'code') {
      f.lang = val || 'text';
      const buf: string[] = [];
      let j = i + 1;
      if (/^\s*```/.test(lines[j] ?? '')) {
        j++;
        while (j < lines.length && !/^\s*```/.test(lines[j]!)) buf.push(lines[j++]!);
        i = j; // closing fence
      } else {
        while (j < lines.length && !KEY.test(lines[j]!)) buf.push(lines[j++]!);
        i = j - 1;
      }
      code = buf.join('\n').replace(/^\n+|\s+$/g, '');
    } else if (key === 'hint') {
      if (val) hints.push(val);
    } else {
      (f as Record<string, string>)[key === 'question' ? 'question' : key] = val;
    }
  }

  if (!f.language) errors.push('Missing "language:" line.');
  if (!f.question) errors.push('Missing "question:" line.');
  if (!f.level || !/^[1-6]$/.test(f.level)) errors.push('"level:" must be a number from 1 to 6 (1 Bronze … 6 Adamantium).');
  if (options.length < 2) errors.push('Add at least 2 options under "options:", one per line starting with "- ", and "+ " for the correct one.');
  if (correct.length !== 1) errors.push('Mark exactly one option as correct with "+ " at the start.');
  else answer = correct[0];
  if (!code) errors.push('Missing code example: add "code: html" (or js, python…) followed by the code lines.');
  if (hints.length > 3) errors.push('Use at most 3 "hint:" lines.');
  if (f.xp && !/^\d+$/.test(f.xp)) errors.push('"xp:" must be a whole number.');
  if (errors.length) return { errors };

  return {
    errors,
    item: {
      language: f.language,
      difficulty: Number(f.level),
      prompt: f.question,
      options,
      answer,
      hints,
      concept_tip: f.tip ?? '',
      snippet: code,
      snippet_lang: (f.lang ?? 'text').toLowerCase(),
      integration_note: f.note ?? '',
      ...(f.xp ? { xp_reward: Number(f.xp) } : {}),
    },
  };
}

export const describeIssues = (e: z.ZodError) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
