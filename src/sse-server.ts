import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { restRouter, getOpenApiSchema } from './restApi.js';

const app = express();
app.use(cors());
app.use(express.json());

const port = parseInt(process.env.MCP_PORT || process.env.PORT || '3005', 10);

// Store active transports by session ID
const transports = new Map<string, SSEServerTransport>();

function createMcpServer() {
  const server = new McpServer({
    name: 'pos-analytics-mcp-server',
    version: '1.0.0'
  });
  registerTools(server);
  registerResources(server);
  return server;
}

// 1. SSE Connection Endpoint (Standard MCP SSE transport)
app.get('/sse', async (req, res) => {
  console.log('New incoming SSE MCP client connection');
  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer();

  await server.connect(transport);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    console.log(`SSE Client ${transport.sessionId} disconnected`);
    transports.delete(transport.sessionId);
  });
});

// 2. Incoming client messages endpoint (POST /messages?sessionId=...)
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).send('Session not found or expired');
    return;
  }

  await transport.handlePostMessage(req, res);
});

// 3. REST API Routes for Direct Integration / ChatGPT Custom GPT Actions
app.use('/api', restRouter);

// 4. OpenAPI Specification Endpoint (for ChatGPT GPT Builder Actions)
app.get('/openapi.json', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'mcp.restiq.ge';
  const baseUrl = `${protocol}://${host}`;
  res.json(getOpenApiSchema(baseUrl));
});

// 5. Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'pos-analytics-mcp-server',
    active_sessions: transports.size,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`🌐 POS Analytics MCP Server (SSE/HTTP) listening on http://localhost:${port}`);
  console.log(`📡 SSE Endpoint (MCP): http://localhost:${port}/sse`);
  console.log(`✉️ Message Endpoint: http://localhost:${port}/messages`);
  console.log(`📖 OpenAPI Spec (ChatGPT Actions): http://localhost:${port}/openapi.json`);
  console.log(`❤️ Health Check: http://localhost:${port}/health`);
});
