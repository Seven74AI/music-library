-- Add Local Upload Service
-- This service is required for local file uploads
-- Using INSERT OR IGNORE to avoid duplicates if service already exists (e.g., from seed)
-- Since 'name' has a UNIQUE constraint, INSERT OR IGNORE will skip if 'local' already exists
INSERT OR IGNORE INTO Service (id, name, displayName, baseUrl, logoUrl, isActive, createdAt, updatedAt) 
VALUES(
  'clnf2zvli0000pcou3zzzzomf', -- Fixed ID for consistency (similar format to YouTube service)
  'local',
  'Local Upload',
  '',
  NULL,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);