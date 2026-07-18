CREATE SCHEMA IF NOT EXISTS workbench;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workbench_app') THEN
    CREATE ROLE workbench_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workbench_maintenance') THEN
    CREATE ROLE workbench_maintenance NOLOGIN;
  END IF;
  ALTER ROLE workbench_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ALTER ROLE workbench_maintenance NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
END
$$;

GRANT USAGE ON SCHEMA workbench TO workbench_app, workbench_maintenance;

CREATE TABLE workbench.job_submission_receipts (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  operation text NOT NULL CHECK (operation = 'create-job'),
  "keyDigest" text NOT NULL CHECK ("keyDigest" ~ '^[a-f0-9]{64}$'),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "jobId" text NOT NULL,
  "correlationId" text NOT NULL,
  "actorId" text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING','COMPLETED')),
  "httpStatus" integer CHECK ("httpStatus" BETWEEN 200 AND 299),
  "responseBody" jsonb,
  "completedAt" timestamp(3),
  "expiresAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", operation, "keyDigest"),
  UNIQUE ("tenantId", "jobId"),
  CHECK (
    (state = 'PENDING' AND "httpStatus" IS NULL AND "responseBody" IS NULL AND "completedAt" IS NULL)
    OR
    (state = 'COMPLETED' AND "httpStatus" IS NOT NULL AND "responseBody" IS NOT NULL AND "completedAt" IS NOT NULL)
  )
);
CREATE INDEX job_submission_receipts_expires_idx ON workbench.job_submission_receipts("expiresAt");
CREATE INDEX job_submission_receipts_tenant_created_idx ON workbench.job_submission_receipts("tenantId", "createdAt");

CREATE OR REPLACE FUNCTION workbench.current_tenant_id()
RETURNS text LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_tenant_id', true), '') $$;
REVOKE ALL ON FUNCTION workbench.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workbench.current_tenant_id() TO workbench_app;

ALTER TABLE workbench.job_submission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workbench.job_submission_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workbench.job_submission_receipts TO workbench_app
  USING ("tenantId" = workbench.current_tenant_id())
  WITH CHECK ("tenantId" = workbench.current_tenant_id());
CREATE POLICY maintenance_access ON workbench.job_submission_receipts TO workbench_maintenance
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON workbench.job_submission_receipts TO workbench_app;
GRANT UPDATE (state, "httpStatus", "responseBody", "completedAt", "updatedAt")
  ON workbench.job_submission_receipts TO workbench_app;
GRANT SELECT, DELETE ON workbench.job_submission_receipts TO workbench_maintenance;

CREATE OR REPLACE FUNCTION workbench.delete_expired_job_submission_receipt(
  tenant_id text, receipt_operation text, key_digest text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, workbench
AS $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM workbench.job_submission_receipts
   WHERE "tenantId" = tenant_id AND operation = receipt_operation
     AND "keyDigest" = key_digest AND "expiresAt" <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

CREATE OR REPLACE FUNCTION workbench.cleanup_expired_job_submission_receipts(batch_limit integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, workbench
AS $$
DECLARE deleted_count integer;
BEGIN
  WITH expired AS (
    SELECT id FROM workbench.job_submission_receipts
     WHERE "expiresAt" <= now() ORDER BY "expiresAt" LIMIT batch_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM workbench.job_submission_receipts receipt
   USING expired WHERE receipt.id = expired.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

ALTER FUNCTION workbench.delete_expired_job_submission_receipt(text, text, text) OWNER TO workbench_maintenance;
ALTER FUNCTION workbench.cleanup_expired_job_submission_receipts(integer) OWNER TO workbench_maintenance;
REVOKE ALL ON FUNCTION workbench.delete_expired_job_submission_receipt(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION workbench.cleanup_expired_job_submission_receipts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workbench.delete_expired_job_submission_receipt(text, text, text) TO workbench_app;
GRANT EXECUTE ON FUNCTION workbench.cleanup_expired_job_submission_receipts(integer) TO workbench_app;
