CREATE TABLE "admins" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"added_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
