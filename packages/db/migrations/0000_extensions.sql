-- Required extensions. Docker installs run infra/postgres/init too; this keeps other hosts working.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
