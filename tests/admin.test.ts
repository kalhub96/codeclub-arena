import { describe, expect, it } from 'vitest';
import { parseTemplate, QuestionItem, TEMPLATE } from '../src/services/questionTemplate.js';

describe('question template', () => {
  it('parses the shipped example into a valid question', () => {
    const p = parseTemplate(TEMPLATE);
    expect(p.errors).toEqual([]);
    const v = QuestionItem.safeParse(p.item);
    expect(v.success).toBe(true);
    if (v.success) {
      expect(v.data.answer).toBe('<h1>');
      expect(v.data.options).toHaveLength(4);
      expect(v.data.hints).toHaveLength(2);
      expect(v.data.snippet).toContain('<h1>My page</h1>');
      expect(v.data.snippet_lang).toBe('html');
    }
  });
  it('accepts the /addquestion command on the first line and fenced code', () => {
    const t = `/addquestion\nlanguage: Python\nlevel: 2\nquestion: What does len([1,2]) return?\noptions:\n+ 2\n- 1\ncode: python\n\`\`\`\nprint(len([1, 2]))\n\`\`\`\nnote: len counts items.`;
    const p = parseTemplate(t);
    expect(p.errors).toEqual([]);
    expect((p.item as { snippet: string }).snippet).toBe('print(len([1, 2]))');
  });
  it('reports every missing piece in plain words', () => {
    const p = parseTemplate('language: HTML\nquestion: Short?');
    expect(p.item).toBeUndefined();
    expect(p.errors.join(' ')).toMatch(/level/);
    expect(p.errors.join(' ')).toMatch(/options/);
    expect(p.errors.join(' ')).toMatch(/code/);
  });
  it('requires exactly one correct option', () => {
    const p = parseTemplate('language: HTML\nlevel: 1\nquestion: Which one is it?\noptions:\n+ a\n+ b\ncode: html\n<p>x</p>');
    expect(p.errors.join(' ')).toMatch(/exactly one/);
  });
});

import { friendPromptDue } from '../src/services/friends.js';
describe('friend prompt trigger', () => {
  it('fires on every 5th correct answer, level-up or badge-up, never at zero', () => {
    expect(friendPromptDue({ correctCount: 5, levelUp: false, badgeUp: false })).toBe(true);
    expect(friendPromptDue({ correctCount: 10, levelUp: false, badgeUp: false })).toBe(true);
    expect(friendPromptDue({ correctCount: 4, levelUp: false, badgeUp: false })).toBe(false);
    expect(friendPromptDue({ correctCount: 3, levelUp: true, badgeUp: false })).toBe(true);
    expect(friendPromptDue({ correctCount: 3, levelUp: false, badgeUp: true })).toBe(true);
    expect(friendPromptDue({ correctCount: 0, levelUp: true, badgeUp: true })).toBe(false);
  });
});
