-- Initialize extensions and basic schema for Autonomous AI OS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Basic verification
SELECT extname, extversion FROM pg_extension WHERE extname IN ('uuid-ossp', 'vector');
