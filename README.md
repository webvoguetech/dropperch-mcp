# DropPerch MCP server

Ask your AI assistant when a domain expires, what lifecycle stage it is in, when it will drop, or when its SSL certificate runs out. The answers are read live from the domain's own registry over RDAP, not from a cached WHOIS copy.

- **No API key, no account.** Each lookup goes from your machine straight to the authoritative registry. Nothing passes through a DropPerch server.
- **Works in** Claude Desktop, Claude Code, Cursor, VS Code, Windsurf and any other MCP client that runs stdio servers.
- **MIT licensed.** Made by [DropPerch](https://dropperch.com/?utm_source=github&utm_medium=readme&utm_campaign=mcp), the domain expiry monitor.

## Tools

| Tool | What it answers |
|---|---|
| `check_domain` | Expiry date, days left, lifecycle stage (active, grace, redemption, pending delete), registrar, nameservers, status codes, registration date, likely drop date |
| `check_domains` | The same for up to 50 domains at once, with the soonest expiry called out |
| `domain_drop_date` | When an expiring or expired domain will be deleted and become registrable |
| `ssl_certificate` | Certificate issuer, expiry date, days left, and whether browsers trust it |

Try asking:

- "When does github.com expire, and who is the registrar?"
- "Check these client domains and tell me which ones expire in the next 60 days: …"
- "Is old-brand.com in redemption? When would it drop?"
- "Is the SSL certificate on our site about to expire?"

## Install

You need Node.js 20 or newer.

**Claude Code**

```sh
claude mcp add dropperch -- npx -y dropperch-mcp
```

**Claude Desktop, Cursor, Windsurf.** Add this to the client's MCP config (`claude_desktop_config.json`, `~/.cursor/mcp.json`, …):

```json
{
  "mcpServers": {
    "dropperch": {
      "command": "npx",
      "args": ["-y", "dropperch-mcp"]
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "dropperch": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "dropperch-mcp"]
    }
  }
}
```

## Good to know

- **Some TLDs publish no RDAP service** (`.de` is one), and some publish no expiry date (SIDN's `.nl`). The tools say so rather than guess.
- **Drop dates follow ICANN timelines** for gTLDs: up to 45 days of auto-renew grace, 30 days of redemption, then about 5 days of pending delete. Country-code TLDs set their own rules, so no date is estimated for them.
- **A 404 from the registry is an answer:** the name is not registered.

## Ongoing alerts

These tools check once, when you ask. To be emailed before a domain expires, when it enters redemption or pending delete, when it drops, or when its certificate is about to lapse, watch it on [DropPerch](https://dropperch.com/?utm_source=github&utm_medium=readme&utm_campaign=mcp). It's free for a small watchlist. Each tool result includes a `monitor_url` that opens signup with the domain filled in.

## License

MIT © Web Vogue Technologies
