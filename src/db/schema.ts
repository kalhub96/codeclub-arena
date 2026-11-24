import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const genderEnum = pgEnum('gender', ['male', 'female']);
export const studentStatusEnum = pgEnum('student_status', ['pending', 'active', 'banned']);
export const friendStatusEnum = pgEnum('friend_status', ['pending', 'accepted', 'declined']);
export const questionStatusEnum = pgEnum('question_status', ['draft', 'pending_review', 'approved', 'retired']);

export const tracks = pgTable('tracks', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const languages = pgTable('languages', {
  id: serial('id').primaryKey(),
  trackId: integer('track_id')
    .notNull()
    .references(() => tracks.id),
  name: text('name').notNull().unique(),
  orderNo: integer('order_no').notNull().default(0),
});

export const invites = pgTable('invites', {
  id: serial('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(500),
  uses: integer('uses').notNull().default(0),
  createdBy: bigint('created_by', { mode: 'number' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const students = pgTable(
  'students',
  {
    id: serial('id').primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    username: text('username'),
    fullName: text('full_name').notNull(),
    batchYear: integer('batch_year').notNull(),
    gender: genderEnum('gender').notNull(),
    status: studentStatusEnum('status').notNull().default('active'),
    xp: integer('xp').notNull().default(0),
    badge: text('badge').notNull().default('Bronze'),
    streak: integer('streak').notNull().default(0),
    lastActiveDate: date('last_active_date'),
    privacyShowName: boolean('privacy_show_name').notNull().default(true),
    privacyAllowDm: boolean('privacy_allow_dm').notNull().default(false),
    activeLanguageId: integer('active_language_id').references(() => languages.id),
    inviteId: integer('invite_id').references(() => invites.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('students_gender_status_idx').on(t.gender, t.status), index('students_xp_idx').on(t.xp)],
);

export const studentLanguageProgress = pgTable(
  'student_language_progress',
  {
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    languageId: integer('language_id')
      .notNull()
      .references(() => languages.id),
    xp: integer('xp').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.languageId] }), index('slp_lang_xp_idx').on(t.languageId, t.xp)],
);

export const questions = pgTable(
  'questions',
  {
    id: serial('id').primaryKey(),
    externalId: text('external_id').notNull().unique(),
    languageId: integer('language_id')
      .notNull()
      .references(() => languages.id),
    difficulty: integer('difficulty').notNull(), // 1..6 = Bronze..Adamantium
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<string[]>().notNull(),
    answerKey: text('answer_key').notNull(), // must equal one of options
    hints: jsonb('hints').$type<string[]>().notNull().default([]),
    conceptTip: text('concept_tip').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    snippetLang: text('snippet_lang').notNull().default('text'),
    integrationNote: text('integration_note').notNull().default(''),
    xpReward: integer('xp_reward').notNull().default(10),
    status: questionStatusEnum('status').notNull().default('pending_review'),
    source: text('source').notNull().default('manual'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('questions_slot_idx').on(t.languageId, t.difficulty, t.status)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    questionId: integer('question_id')
      .notNull()
      .references(() => questions.id),
    attempts: integer('attempts').notNull().default(0),
    hintsUsed: integer('hints_used').notNull().default(0),
    isCorrect: boolean('is_correct'),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    questionVersion: integer('question_version').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    solvedAt: timestamp('solved_at', { withTimezone: true }), // set when finalized (correct or out of attempts)
  },
  (t) => [uniqueIndex('submissions_student_question_uq').on(t.studentId, t.questionId), index('submissions_q_idx').on(t.questionId)],
);

export const badgesLog = pgTable('badges_log', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id')
    .notNull()
    .references(() => students.id),
  badge: text('badge').notNull(),
  earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
});

export const admins = pgTable('admins', {
  telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
  username: text('username'),
  addedBy: bigint('added_by', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const friendships = pgTable(
  'friendships',
  {
    id: serial('id').primaryKey(),
    requesterId: integer('requester_id')
      .notNull()
      .references(() => students.id),
    addresseeId: integer('addressee_id')
      .notNull()
      .references(() => students.id),
    status: friendStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('friend_pair_uq').on(t.requesterId, t.addresseeId), index('friend_addressee_idx').on(t.addresseeId, t.status)],
);

export type Student = typeof students.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
