CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'pending_review', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('pending', 'active', 'banned');--> statement-breakpoint
CREATE TABLE "badges_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"badge" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 500 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_by" bigint NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" serial PRIMARY KEY NOT NULL,
	"track_id" integer NOT NULL,
	"name" text NOT NULL,
	"order_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "languages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"language_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer_key" text NOT NULL,
	"hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concept_tip" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"snippet_lang" text DEFAULT 'text' NOT NULL,
	"integration_note" text DEFAULT '' NOT NULL,
	"xp_reward" integer DEFAULT 10 NOT NULL,
	"status" "question_status" DEFAULT 'pending_review' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "student_language_progress" (
	"student_id" integer NOT NULL,
	"language_id" integer NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "student_language_progress_student_id_language_id_pk" PRIMARY KEY("student_id","language_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"full_name" text NOT NULL,
	"batch_year" integer NOT NULL,
	"gender" "gender" NOT NULL,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"badge" text DEFAULT 'Bronze' NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_active_date" date,
	"privacy_show_name" boolean DEFAULT true NOT NULL,
	"privacy_allow_dm" boolean DEFAULT false NOT NULL,
	"active_language_id" integer,
	"invite_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"is_correct" boolean,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"question_version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"solved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tracks_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "badges_log" ADD CONSTRAINT "badges_log_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "languages" ADD CONSTRAINT "languages_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_language_progress" ADD CONSTRAINT "student_language_progress_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_language_progress" ADD CONSTRAINT "student_language_progress_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_active_language_id_languages_id_fk" FOREIGN KEY ("active_language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_slot_idx" ON "questions" USING btree ("language_id","difficulty","status");--> statement-breakpoint
CREATE INDEX "slp_lang_xp_idx" ON "student_language_progress" USING btree ("language_id","xp");--> statement-breakpoint
CREATE INDEX "students_gender_status_idx" ON "students" USING btree ("gender","status");--> statement-breakpoint
CREATE INDEX "students_xp_idx" ON "students" USING btree ("xp");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_student_question_uq" ON "submissions" USING btree ("student_id","question_id");--> statement-breakpoint
CREATE INDEX "submissions_q_idx" ON "submissions" USING btree ("question_id");