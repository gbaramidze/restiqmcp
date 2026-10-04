#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

// Create MCP Server Instance
const server = new McpServer({
  name: 'pos-analytics-mcp-server',
  version: '1.0.0'
});

// Register all Analytics Tools & Resources
registerTools(server);
registerResources(server);

// Start stdio transport for Claude Desktop / Cursor / Antigravity / CLI
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only (stdout is reserved for MCP JSON-RPC protocol!)
  console.error('🚀 POS Analytics MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in MCP Server:', error);
  process.exit(1);
});
