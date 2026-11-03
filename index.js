#!/usr/bin/env node
/**
 * DropPerch MCP server: live domain expiry, lifecycle stage, drop date and SSL
 * certificate checks for any MCP client (Claude, Cursor, VS Code, ...).
 *
 * Runs on stdio. No API key and no account: each lookup goes from this
 * machine to the authoritative registry over RDAP, and each certificate is
 * read with a TLS handshake.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFileSync } from 'node:fs'

import { createTools } from './lib/tools.js'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const tools = createTools()

const server = new McpServer({ name: 'dropperch', version })

/** Text for the model: the one-line summary, then the full record as JSON. */
const reply = (result) => ({
  content: [{ type: 'text', text: `${result.summary}\n\n${JSON.stringify(result, null, 2)}` }],
  isError: Boolean(result.error && result.error !== 'invalid'),
})

const domain = z.string().min(3).max(253).describe('A domain name, e.g. example.com')

server.registerTool(
  'check_domain',
  {
    title: 'Check a domain',
    description:
      'Expiry date, days left, lifecycle stage (active, grace, redemption, pending delete), registrar, nameservers, registry status codes, registration date and likely drop date for one domain, read live from its registry over RDAP.',
    inputSchema: { domain },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => reply(await tools.checkDomain(args)),
)

server.registerTool(
  'check_domains',
  {
    title: 'Check many domains',
    description:
      'The same live registry check for up to 50 domains at once, with the soonest expiry called out. Use it to audit a portfolio or a client list.',
    inputSchema: { domains: z.array(z.string()).min(1).max(50).describe('Domain names') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => reply(await tools.checkDomains(args)),
)

server.registerTool(
  'domain_drop_date',
  {
    title: 'When will a domain drop?',
    description:
      'Estimate when an expiring or expired domain will be deleted and become registrable, from its current registry status and ICANN timelines (redemption 30 days, pending delete about 5).',
    inputSchema: { domain },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => reply(await tools.dropDate(args)),
)

server.registerTool(
  'ssl_certificate',
  {
    title: 'Check an SSL certificate',
    description:
      'Read the HTTPS certificate on a domain (or www): issuer, expiry date, days left, and whether browsers trust it.',
    inputSchema: { domain },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => reply(await tools.sslCertificate(args)),
)

await server.connect(new StdioServerTransport())
