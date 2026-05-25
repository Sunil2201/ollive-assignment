# Prism

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Redux Toolkit, React Redux, Tailwind CSS v4, shadcn/ui, Lucide React |
| Backend API | Python 3.11+, Flask, gevent |
| Ingestion Service | Python 3.11+, Flask, Redis Streams |
| LLM SDK | Internal package (`llm_sdk`) — anthropic, openai, google-genai |
| Database | PostgreSQL 15+ |
| Cache / Queue | Redis |

---

## Setup Instructions

### Prerequisites

- Node.js ≥ 18 and npm
- Python 3.11+
- PostgreSQL 15+
- Redis

### 1. Clone and install frontend dependencies

```bash
git clone https://github.com/Sunil2201/ollive-assignment
cd ollive-assignment
npm install
```

### 2. Create environment file

Copy `.env.example` to `.env` in the project root and fill in the values:

```env
# LLM Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/llm_logger

# Redis
REDIS_URL=redis://localhost:6379

# Service ports
FLASK_PORT=5000
INGESTION_PORT=5001

# LLM token limits
MAX_CONTEXT_TOKENS=8000
MAX_OUTPUT_TOKENS=16000
COMPACTION_TRIGGER_TOKENS=50000
```

### 3. Set up the database

```bash
psql -U postgres -c "CREATE DATABASE llm_logger;"
psql -U postgres -d llm_logger -f infra/postgres/init.sql
```

### 4. Install Python dependencies

```bash
# Internal SDK (editable install — required by both backend and ingestion)
cd packages/sdk
pip install -e .
cd ../..

# Backend
cd apps/backend
pip install -r requirements.txt
cd ../..

# Ingestion service
cd apps/ingestion
pip install -r requirements.txt
cd ../..
```

> **Tip:** Use a single virtual environment at the repo root so the SDK editable install is shared.

### 5. Start services

Open three terminals:

```bash
# Terminal 1 — Backend API (http://localhost:5000)
cd apps/backend
python app.py

# Terminal 2 — Ingestion service (http://localhost:5001)
cd apps/ingestion
python app.py

# Terminal 3 — Frontend (http://localhost:3000)
npm run dev
```

Visit **http://localhost:3000** to open the dashboard.

---

## Architecture Overview

```
Browser (React 19 + Vite)
      │  SSE stream + REST
      ▼
Backend API (Flask/Python)   ←──── SDK wraps every LLM call
      │  publishes event
      ▼
Redis Streams  ─────────────────► Ingestion Service (Flask/Python)
                                        │ validates + redacts PII
                                        ▼
                                   PostgreSQL
                                        │
                                   Dashboard API
                                        ▼
                               Frontend /dashboard page
```

**Key services:**

- **Backend API** — handles user-facing chat and conversation management. Delegates LLM calls to the SDK and fires-and-forgets log events.
- **LLM SDK** (`packages/sdk`) — unified multi-provider interface with context trimming, PII redaction, and streaming. Providers: Anthropic, OpenAI, Gemini.
- **Ingestion Service** — consumes Redis Streams in batches, validates with Pydantic, writes to PostgreSQL. Falls back to direct HTTP if Redis is unavailable.
- **Frontend** — Next.js dashboard with conversation view, per-conversation metrics, and provider analytics charts.

---

## Schema Design Decisions

Three tables: `conversations`, `messages`, `inference_logs`.

### `conversations`
Stores session-scoped conversation threads. `session_id` (from the `X-Session-ID` request header) provides lightweight multi-tenant isolation without requiring auth.

### `messages`
Each message belongs to a conversation (CASCADE delete). Composite index on `(conversation_id, created_at)` supports ordered fetching efficiently.

### `inference_logs`
Decoupled from messages — a log row records one LLM API call. `conversation_id` is **nullable**: logs are preserved even if the conversation is deleted or if the log arrives before the conversation is created (race condition on startup).

---

## Tradeoffs Made

| Decision | Tradeoff |
|----------|---------|
| **Session-based isolation (no auth)** | Fast to build and stateless. Not suitable for production multi-user deployments — any client that guesses a session ID can read its data. |
| **Context trimming at 8,000 tokens** | Keeps costs predictable but may truncate long conversations. Anthropic's compaction feature is used as an alternative for that provider. |
| **`input_preview` truncation at 500 chars** | Protects DB storage but loses full content for post-hoc analysis. A separate cold-storage path (e.g., S3) would capture full payloads. |

---

## What I Would Improve With More Time

1. **Authentication & authorisation** — Replace `X-Session-ID` with JWTs or session cookies so data is properly scoped to authenticated users.
2. **Memory with Mem0** — Integrate [Mem0](https://mem0.ai) to give the assistant persistent, user-scoped memory across conversations, enabling more coherent long-running interactions.
3. **AWS deployment + containerisation** — Package each service as a Docker container, push to ECR, and deploy via ECS Fargate (or EKS). Add RDS for Postgres and ElastiCache for Redis to get managed scaling, backups, and HA out of the box.
4. **Worker-queue for parallel LLM tasks** — Replace the single daemon thread with a proper worker queue (Celery + Redis or AWS SQS) to process multiple inference log batches in parallel and handle traffic spikes gracefully.
5. **Docker Compose for local dev** — A single `docker-compose up` to spin up Postgres, Redis, backend, ingestion, and frontend removes the multi-terminal setup burden entirely.