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
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui
- **AI**: Replit Anthropic Integration (claude-sonnet-4-6, claude-opus-4-6)

## Key Features

- Multi-conversation chat with Claude AI streaming (SSE)
- Model selector: Claude Sonnet 4.6 / Claude Opus 4.6
- MCP server management (add, test, discover tools)
- Agent mode vs Tool mode in chat
- Dark-mode UI with glowing accents, framer-motion animations
- System status bar (connected servers, tools count, agent state) — polls every 30s
- Auto-title conversations: after first AI response, title is set to first 60 chars of user message
- Inline conversation rename via sidebar 3-dot menu → Edit text field → Enter to confirm
- Auto-create conversation on send: if no conversation selected, creates one and auto-navigates

## Structure

```text
artifacts/
├── api-server/         # Express API server (port 8080)
└── agent-chat-ui/      # React + Vite frontend (port from $PORT)
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
- `messages` — Chat messages (role, content, model, conversationId)
- `mcp_servers` — MCP server configs (transport, auth, status)
- `mcp_tools` — Discovered tools per server
- `mcp_resources` — Resources per server
- `mcp_prompts` — Prompt templates per server
- `executions` — Tool execution records with timeline
- `execution_logs` — Per-execution log entries
- `settings` — Key/value app settings
- `attachments` — File attachments for conversations

## API Routes (mounted at /api)

- `GET/POST /api/anthropic/conversations` — list/create chats
- `GET/PATCH/DELETE /api/anthropic/conversations/:id` — get/update/delete
- `GET/POST /api/anthropic/conversations/:id/messages` — messages + SSE stream
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

## Streaming (SSE)

Chat messages stream via SSE at `POST /api/anthropic/conversations/:id/messages`.
Format: `data: {"content":"..."}` chunks, then `data: {"done":true}`.
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
pnpm --filter @workspace/api-spec run codegen
```

After DB schema changes:
```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db exec tsc -p tsconfig.json
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
- `PORT` — Port for each artifact's dev server (auto-set by Replit)
- `BASE_PATH` — Base URL path for the artifact (auto-set by Replit)
