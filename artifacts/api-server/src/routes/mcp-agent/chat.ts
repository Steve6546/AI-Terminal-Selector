import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { handleRouteError } from "../../lib/handle-error";

const router: IRouter = Router();

interface McpServerContext {
  id: number;
  name: string;
  description?: string | null;
  transportType: string;
  endpoint?: string | null;
  command?: string | null;
  authType: string;
  status: string;
  enabled: boolean;
  toolCount: number;
  timeout?: number | null;
  retryCount?: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are an intelligent MCP Server Manager assistant embedded directly inside the MCP Servers management page of an AI agent platform. You have full awareness of the servers currently listed on this page and can perform actions on them.

Your capabilities:
- List and summarize existing MCP servers
- Create new MCP servers with appropriate settings
- Edit existing server settings (name, description, endpoint, auth, timeout, retries, enabled state)
- Delete servers (with user confirmation)
- Enable or disable servers
- Suggest optimal authentication and connection settings based on the server type
- Analyze server statuses and troubleshoot connection issues
- Clone a server with a new name

MCP Transport Types:
- "streamable-http": Remote HTTP server following the Streamable HTTP MCP spec. Requires an endpoint URL ending in /mcp or similar.
- "stdio": Local process launched as a child process. Requires a command (e.g. npx -y @modelcontextprotocol/server-filesystem).

Authentication Options:
- "none": Public or internally trusted endpoint, no credentials needed
- "bearer": RFC 6750 Bearer Token, sent as Authorization: Bearer <token>
- "api-key": Custom API key in a header or query parameter  
- "oauth": OAuth 2.0 with PKCE flow

Best Practices:
- Timeout: 30s is standard, 60s for slow or heavy tools, 5s for fast local stdio servers
- Retries: 3 is standard, 0 for stdio (no network issues), up to 5 for unreliable remotes
- Use HTTPS for all HTTP endpoints in production
- The standard MCP HTTP path is /mcp (e.g. https://example.com/mcp)

Behavior guidelines:
- Be concise and action-oriented. Prefer doing things over explaining them.
- When you perform an action, briefly explain what you did.
- For destructive actions (delete, disable), always use the confirm_action tool and let the user confirm.
- When creating or editing servers, provide sensible defaults based on the server type.
- If asked about a specific server, reference it by name.
- Respond in the same language as the user.
- Support Arabic, English, and other languages naturally.

You are currently viewing the MCP Servers page. The user can see the servers listed below in your context.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "create_server",
      description: "Create a new MCP server with the specified settings",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Server display name" },
          description: { type: "string", description: "Optional description" },
          transportType: { type: "string", enum: ["streamable-http", "stdio"], description: "Transport protocol" },
          endpoint: { type: "string", description: "HTTP endpoint URL (for streamable-http)" },
          command: { type: "string", description: "Shell command to launch server (for stdio)" },
          args: { type: "string", description: "Space-separated additional arguments (for stdio)" },
          authType: { type: "string", enum: ["none", "bearer", "api-key", "oauth"], description: "Authentication method" },
          timeout: { type: "number", description: "Connection timeout in seconds (5-300)" },
          retryCount: { type: "number", description: "Retry attempts on failure (0-10)" },
          enabled: { type: "boolean", description: "Whether the server is active" },
        },
        required: ["name", "transportType"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_server",
      description: "Edit an existing MCP server's settings",
      parameters: {
        type: "object",
        properties: {
          serverId: { type: "number", description: "ID of the server to edit" },
          serverName: { type: "string", description: "Current name of the server (for reference)" },
          name: { type: "string", description: "New server name" },
          description: { type: "string", description: "New description" },
          endpoint: { type: "string", description: "New endpoint URL" },
          command: { type: "string", description: "New command" },
          args: { type: "string", description: "New arguments" },
          authType: { type: "string", enum: ["none", "bearer", "api-key", "oauth"], description: "New auth method" },
          timeout: { type: "number", description: "New timeout in seconds" },
          retryCount: { type: "number", description: "New retry count" },
          enabled: { type: "boolean", description: "Enable or disable the server" },
        },
        required: ["serverId", "serverName"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_server",
      description: "Delete an MCP server. ALWAYS requires user confirmation before executing.",
      parameters: {
        type: "object",
        properties: {
          serverId: { type: "number", description: "ID of the server to delete" },
          serverName: { type: "string", description: "Name of the server (shown in confirmation)" },
        },
        required: ["serverId", "serverName"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "toggle_server",
      description: "Enable or disable an MCP server",
      parameters: {
        type: "object",
        properties: {
          serverId: { type: "number", description: "ID of the server" },
          serverName: { type: "string", description: "Name of the server" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["serverId", "serverName", "enabled"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "test_server",
      description: "Test the connection to an MCP server",
      parameters: {
        type: "object",
        properties: {
          serverId: { type: "number", description: "ID of the server to test" },
          serverName: { type: "string", description: "Name of the server" },
        },
        required: ["serverId", "serverName"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clone_server",
      description: "Clone an existing server with a new name",
      parameters: {
        type: "object",
        properties: {
          serverId: { type: "number", description: "ID of the server to clone" },
          serverName: { type: "string", description: "Original server name" },
          newName: { type: "string", description: "Name for the cloned server" },
        },
        required: ["serverId", "serverName", "newName"],
      },
    },
  },
];

router.post("/mcp-agent/chat", async (req, res) => {
  try {
    const { message, history, servers } = req.body as {
      message: string;
      history: ChatMessage[];
      servers: McpServerContext[];
    };

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const serversContext = servers?.length
      ? `\nCurrent MCP Servers on this page (${servers.length} total):\n${servers
          .map(
            (s) =>
              `- ID:${s.id} | "${s.name}" | ${s.transportType} | status: ${s.status} | enabled: ${s.enabled} | ${s.toolCount} tools${s.endpoint ? ` | endpoint: ${s.endpoint}` : ""}${s.command ? ` | command: ${s.command}` : ""}${s.description ? ` | desc: ${s.description}` : ""}`
          )
          .join("\n")}`
      : "\nNo MCP servers currently on this page.";

    const chatMessages: Parameters<typeof openai.chat.completions.create>[0]["messages"] = [
      { role: "system", content: SYSTEM_PROMPT + serversContext },
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: chatMessages,
      tools: TOOLS,
      tool_choice: "auto",
      stream: true,
    });

    let fullText = "";
    let toolCallName = "";
    let toolCallArgs = "";
    let toolCallId = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullText += delta.content;
        res.write(`data: ${JSON.stringify({ type: "text", content: delta.content })}\n\n`);
      }

      if (delta?.tool_calls?.[0]) {
        const tc = delta.tool_calls[0];
        if (tc.id) toolCallId = tc.id;
        if (tc.function?.name) toolCallName += tc.function.name;
        if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
      }
    }

    if (toolCallName && toolCallArgs) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(toolCallArgs);
      } catch {
        parsedArgs = {};
      }

      const requiresConfirmation = ["delete_server"].includes(toolCallName);

      res.write(
        `data: ${JSON.stringify({
          type: "action",
          action: {
            id: toolCallId,
            name: toolCallName,
            args: parsedArgs,
            requiresConfirmation,
          },
        })}\n\n`
      );
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "MCP agent chat failed");
    if (!res.headersSent) {
      handleRouteError(res, err, "Agent chat failed");
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: "Agent error occurred" })}\n\n`);
      res.end();
    }
  }
});

export default router;
