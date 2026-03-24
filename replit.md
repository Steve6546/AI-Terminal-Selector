# Agent Tool Chat — Workspace

## Overview

**Agent Tool Chat** is an MCP (Model Context Protocol) client platform with AI chat, terminal, MCP server management, tool execution with timeline visualization, and a comprehensive settings system. Built as a pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Next.js 15 App Router + Tailwind CSS v4 + shadcn/ui
- **AI**: Replit Anthropic Integration (claude-sonnet-4-6, claude-opus-4-6)

## Key Features

- Multi-conversation chat with Claude AI streaming (SSE)
- Model selector: Claude Sonnet 4.6 / Claude Opus 4.6
- MCP server management (add, test, discover tools, deep health checks)
- **MCP Server Detail Page**: capabilities browser with tools/resources/prompts tabs, risk badges (low/medium/high based on tool names + approval status), approval toggle per tool, test connection + refresh tools buttons, live SSE status updates, info badges for last-checked/success/failure/latency
- **Deep Health Checks**: Python `/gateway/deep-health` endpoint performs full MCP handshake → list capabilities → measure latency → detect degraded/auth_required states; Node.js health check job runs every 60s
- **6-state server lifecycle**: checking, connected, degraded, auth_required, disconnected, error — persisted to DB with latencyMs, lastErrorMessage, lastSuccessAt, lastFailureAt columns
- **AI Assistant sidebar** on MCP Servers page: slides in from the right, powered by gpt-5.2 via SSE streaming, understands natural language commands to create/edit/delete/toggle/test/clone servers, shows confirmation action cards, maintains conversation memory within session
- Agent mode vs Tool mode in chat
- Dark-mode UI with glowing accents, framer-motion animations
- System status bar (connected servers, tools count, agent state) — polls every 30s
- Auto-title conversations: after first AI response, AI generates a short title (3-6 words) via claude-haiku-4-5; title animates in the sidebar with a fade transition
- Inline conversation rename via sidebar 3-dot menu → Edit text field → Enter to confirm
- Three-dot context menu on every conversation: Rename, Auto-name with AI, Pin/Unpin, Duplicate, Export (JSON/Markdown), Delete. Always visible on mobile, hover-visible on desktop.
- Copy button on assistant messages (copies text, shows "Copied" toast)
- Retry button on assistant messages: dropdown with "Retry with same model" or "Retry with [other model]" options. Truncates history from that message and regenerates.
- Edit button on user messages: opens inline editor; on send, truncates history from that point and regenerates
- In-session context summarization: if conversation history > 20 messages, older turns are summarized into a compact context block before sending to the model (prevents token limit issues)
- Auto-create conversation on send: if no conversation selected, creates one and auto-navigates
- Real terminal (xterm.js + node-pty) with WebSocket connection
- File attachments (upload files, paste text, JSON, images)
- Comprehensive Settings page with 8 tabs: General, Agent Settings, MCP Servers, Tools, Databases, Security, Logs & Debug, UI Settings
- Per-tool enable/disable and requiresApproval toggles in Settings → Tools
- Database Connectors: add PostgreSQL/MySQL/SQLite connections with encrypted passwords, Test Connection
- Domain allowlist in Security settings
- Logs tab with status/server filters and latency stats

## Structure

```text
artifacts/
├── api-server/         # Express API server (port 8080) — thin proxy for chat, CRUD for everything else
├── agent-backend/      # Python FastAPI agent core (port 9000) — provider routing, agent runtime, tool execution
│   ├── app/
│   │   ├── agent/      # AgentRuntime, ToolExecutor, ApprovalManager
│   │   ├── providers/  # BaseProvider, AnthropicProvider, OpenAIProvider, ProviderRouter
│   │   ├── mcp/        # MCP gateway (tool discovery, execution)
│   │   ├── models/     # Pydantic request/response/event models
│   │   ├── services/   # DB persistence client, TaskManager
│   │   ├── config.py   # Settings via pydantic-settings
│   │   └── main.py     # FastAPI app entry point
│   └── main.py         # uvicorn runner
└── agent-chat-ui/      # React + Next.js 15 App Router frontend (port from $PORT)
lib/
├── api-spec/           # OpenAPI spec + Orval codegen config
├── api-client-react/   # Generated React Query hooks
├── api-zod/            # Generated Zod schemas from OpenAPI
├── db/                 # Drizzle ORM schema + DB connection
└── integrations-anthropic-ai/   # Replit Anthropic AI client
scripts/                # Utility scripts
```

## DB Schema

- `conversations` — AI conversations (id, title, model, timestamps)
- `messages` — Chat messages (role, content, model, conversationId, contentBlocks jsonb)
- `mcp_servers` — MCP server configs (transport, auth, status)
- `mcp_tools` — Discovered tools per server
- `mcp_resources` — Resources per server
- `mcp_prompts` — Prompt templates per server
- `executions` — Tool execution records with timeline
- `execution_logs` — Per-execution log entries
- `settings` — Key/value app settings (value_json is jsonb)
- `attachments` — File attachments for conversations
- `database_connections` — External DB connections (PostgreSQL/MySQL/SQLite, encrypted passwords)
- `runs` — Agent run sessions (id uuid, conversationId, model, status, tokenUsage)
- `run_events` — Events within a run (thinking, text, tool_call, etc.)
- `tool_calls` — Individual tool call records (runId, serverId, toolName, args, result)
- `approval_decisions` — User approval/rejection of tool calls
- `audit_events` — System-wide audit log
- `provider_settings` — AI provider configuration (apiKey encrypted, models, routing)
- `model_routing` — Model routing rules (provider, model, priority)

## API Routes (mounted at /api)

- `GET/POST /api/conversations` — list/create chats
- `GET/PATCH/DELETE /api/conversations/:id` — get/update/delete
- `GET/POST /api/conversations/:id/messages` — messages + SSE stream
- `DELETE /api/conversations/:id/messages-from/:messageId` — truncate messages from a point (for Edit/Retry)
- `GET/POST/PATCH/DELETE /api/mcp-servers` — CRUD MCP servers
- `POST /api/mcp-servers/:id/test` — test connection
- `POST /api/mcp-servers/:id/discover` — discover tools
- `GET /api/mcp-servers/:id/tools` — list server tools
- `GET /api/mcp-servers/:id/resources` — list server resources
- `GET /api/mcp-servers/:id/prompts` — list server prompts
- `PATCH /api/mcp-tools/:toolId` — update tool
- `GET /api/system/status` — system health (connected servers, tool count, agent state)
- `GET/PUT /api/settings` — get/update app settings
- `GET /api/executions` — list tool executions
- `GET/POST /api/database-connections` — list/create DB connections
- `PATCH/DELETE /api/database-connections/:id` — update/delete DB connection
- `POST /api/database-connections/:id/test` — test DB connection (PostgreSQL)

## Architecture (Phase 2 + Phase 3)

Chat messages flow: Frontend → Node.js API (thin proxy) → Python agent-backend → SSE stream back.

- **Node.js API** handles CRUD, message persistence, MCP server/tool lookups, endpoint allowlist enforcement, then proxies to Python
- **Python agent-backend** handles provider routing (Anthropic/OpenAI), agent runtime with tool loop, approval management, SSE event streaming
- **Internal routes** (`/api/internal/*`) are localhost-only and used by Python to persist runs, tool calls, approvals, and executions back to PostgreSQL

### Phase 3: Service Layer & Observability

Routes are thin controllers; all business logic lives in `artifacts/api-server/src/services/`:

| Service | Responsibility |
|---------|---------------|
| `conversation.service` | Conversation CRUD, message handling, chat proxy |
| `mcp-discovery.service` | MCP server CRUD, tool discovery, health checks |
| `execution.service` | Tool execution listing & filtering |
| `run.service` | Agent run lifecycle (create/update runs, tool calls, approvals, events) |
| `provider.service` | AI provider settings & model routing |
| `settings.service` | App settings get/update |
| `system.service` | System status aggregation |
| `audit.service` | Audit event logging (`writeAuditEvent()`) |
| `metrics.service` | Tool execution metrics (latency, counts, error rates) |
| `stream-manager` | Unified SSE connection manager (replaces per-client EventEmitter) |

Observability:
- **Trace ID middleware** (`lib/trace-middleware.ts`): Generates UUID per request, sets `X-Trace-Id` response header, available as `req.traceId`
- **Audit events**: Stored in `audit_events` table, written on settings changes and other important mutations
- **Metrics endpoint**: `GET /api/system/metrics` returns tool metrics + active stream client count

## Streaming (SSE)

Chat messages stream via SSE at `POST /api/conversations/:id/messages`.
Node.js proxies this to Python's `POST /agent/chat` which streams SSE events.
Event types: `run.created`, `model.started`, `thinking.*`, `text.delta`, `tool.*`, `artifact.created`, `run.completed/failed`.
The frontend hook `useChatStream` consumes this with `ReadableStream`.

## Frontend Pages

- `/` — ChatPage (home, no conversation selected, shows empty state with orb)
- `/c/:id` — ChatPage (with conversation, shows messages + input)
- `/servers` — McpServersPage (list/add/delete MCP servers)
- `/settings` — SettingsPage (app settings tabs)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json`. Build order:
1. Build lib packages: `pnpm --filter @workspace/db exec tsc -p tsconfig.json`
2. Build api-zod: `pnpm --filter @workspace/api-zod exec tsc -p tsconfig.json`
3. Typecheck api-server: `pnpm --filter @workspace/api-server run typecheck`

After OpenAPI spec changes:
```bash
cd lib/api-spec && npx orval
```

After DB schema changes:
```bash
cd lib/db && npx drizzle-kit push
```

## Running

- API Server: `pnpm --filter @workspace/api-server run dev` (port 8080)
- Frontend: `pnpm --filter @workspace/agent-chat-ui run dev` (port from $PORT)
- DB push: `pnpm --filter @workspace/db run push`
- Codegen: `pnpm --filter @workspace/api-spec run codegen`

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Anthropic API base URL (auto-set by Replit AI integration)
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Anthropic API key (auto-set by Replit AI integration)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI API base URL (for Python provider router)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key (for Python provider router)
- `AGENT_BACKEND_PORT` — Python agent backend port (default: 9000)
- `PORT` — Port for each artifact's dev server (auto-set by Replit)
- `BASE_PATH` — Base URL path for the artifact (auto-set by Replit)
