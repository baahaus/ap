import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CoreTool } from './tools/index.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface MCPConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: CoreTool[];
  close(): Promise<void>;
}

export async function connectMCPServer(config: MCPServerConfig): Promise<MCPConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    cwd: config.cwd,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'blush', version: '0.1.0' });
  await client.connect(transport);

  const { tools: discovered } = await client.listTools();

  const tools: CoreTool[] = discovered.map((tool) => ({
    name: `mcp__${config.name}__${tool.name}`,
    description: tool.description || '',
    input_schema: (tool.inputSchema || {}) as Record<string, unknown>,
    execute: async (params: Record<string, unknown>): Promise<string> => {
      try {
        const result = await client.callTool({ name: tool.name, arguments: params });

        if (result.isError) {
          const errorText = Array.isArray(result.content)
            ? result.content
                .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map((c) => c.text)
                .join('\n')
            : String(result.content);
          return `Error: ${errorText}`;
        }

        if (Array.isArray(result.content)) {
          return result.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
        }

        return String(result.content ?? '');
      } catch (err) {
        return `Error calling MCP tool ${tool.name}: ${(err as Error).message}`;
      }
    },
  }));

  return {
    name: config.name,
    client,
    transport,
    tools,
    async close() {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
    },
  };
}

export async function connectAllMCPServers(configs: MCPServerConfig[]): Promise<MCPConnection[]> {
  const results = await Promise.allSettled(
    configs.map((config) => connectMCPServer(config)),
  );

  const connections: MCPConnection[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      connections.push(result.value);
    } else {
      process.stderr.write(`Warning: MCP server "${configs[i].name}" failed to connect: ${result.reason?.message || result.reason}\n`);
    }
  }

  return connections;
}

export async function closeMCPConnections(connections: MCPConnection[]): Promise<void> {
  await Promise.allSettled(connections.map((conn) => conn.close()));
}
