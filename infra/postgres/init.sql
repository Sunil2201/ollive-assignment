CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────

CREATE TABLE conversations (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   VARCHAR(100)  NOT NULL,
    title        VARCHAR(500),
    status       VARCHAR(50)   NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20)  NOT NULL,   -- user | assistant | system
    content         TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE inference_logs (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID          REFERENCES conversations(id) ON DELETE SET NULL,
    provider          VARCHAR(100)  NOT NULL,
    model             VARCHAR(200)  NOT NULL,
    status            VARCHAR(50)   NOT NULL DEFAULT 'success',
    latency_ms        INTEGER,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    error_code        VARCHAR(100),
    error_message     TEXT,
    request_at        TIMESTAMPTZ,
    response_at       TIMESTAMPTZ,
    input_preview     VARCHAR(500),
    output_preview    VARCHAR(500),
    pii_redacted      BOOLEAN       NOT NULL DEFAULT FALSE,
    raw_metadata      JSONB,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Auto-update trigger for conversations.updated_at
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────

CREATE INDEX idx_conversations_session ON conversations(session_id);

CREATE INDEX idx_messages_conv        ON messages(conversation_id, created_at);

CREATE INDEX idx_logs_conv            ON inference_logs(conversation_id);
CREATE INDEX idx_logs_created         ON inference_logs(created_at);
CREATE INDEX idx_logs_provider        ON inference_logs(provider, model);
CREATE INDEX idx_logs_status          ON inference_logs(status);