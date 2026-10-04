import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

const app = express();
app.use(cors());

const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3005;

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

// SSE Connection Endpoint
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

// Incoming client messages endpoint (POST /messages?sessionId=...)
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).send('Session not found or expired');
    return;
  }

  await transport.handlePostMessage(req, res);
});

// Health check endpoint
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
  console.log(`📡 SSE Endpoint: http://localhost:${port}/sse`);
  console.log(`✉️ Message Endpoint: http://localhost:${port}/messages`);
  console.log(`❤️ Health Check: http://localhost:${port}/health`);
});
