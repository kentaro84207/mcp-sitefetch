# SiteFetch MCP Server

A Model Context Protocol (MCP) server that fetches entire websites and provides their content to Large Language Models like Claude.

## Features

- **Easy Website Capture**: Simply specify a URL to capture an entire website and add it to Claude's context
- **Caching System**: Downloaded sites are stored in `~/.cache/sitefetch` for efficient reuse
- **MCP Resource Integration**: Captured content is provided as MCP resources for LLM context
- **Tool Operations**: Supports site fetching, cache management, and listing of available sites

## Installation

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build
```

## Configuration

To use with Claude Desktop, add this server to your configuration file:

1. Open your Claude Desktop config file:

   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the following configuration:

```json
{
  "mcpServers": {
    "sitefetch": {
      "command": "node",
      "args": ["/absolute/path/to/sitefetch-mcp/build/index.js"]
    }
  }
}
```

3. Restart Claude Desktop.

## Usage

### Fetching a Website

In Claude Desktop, make a request like:

```
"Please fetch https://example.com and analyze its content"
```

Claude will use the `fetch-site` tool to retrieve the website content:

```
Executing fetch-site tool with parameters:
{
  "url": "https://example.com",
  "forceRefresh": false
}
```

### Available Tools

#### fetch-site

Retrieves website content and stores it as a resource.

**Parameters**:

- `url`: The URL of the website to fetch (required)
- `forceRefresh`: Whether to force update the cache (optional, defaults to false)

#### list-sites

Displays a list of all fetched websites.

#### clear-cache

Removes all cached website data.

### Resource Access

Fetched website content is accessible via the following URI:

```
sitefetch://{encodedUrl}
```

Where `{encodedUrl}` is the URL-encoded address of the website.

## How It Works

1. When the `fetch-site` tool is called, it uses the `sitefetch` library to capture the specified website
2. The content is stored in the `~/.cache/sitefetch` directory
3. The content is provided as an MCP resource with the URI `sitefetch://{encodedUrl}`
4. Claude can reference this resource and include it in its context as needed

## File Structure

- `~/.cache/sitefetch/*.txt`: Cached website content
- `~/.cache/sitefetch/sitefetch_metadata.json`: Metadata for cached websites

## Troubleshooting

### Website Fetching Fails

- Check your internet connection
- Verify the URL is correct
- Use the `list-sites` tool to check already fetched sites
- Try clearing the cache with the `clear-cache` tool and retry

### Cache Issues

- Ensure the `~/.cache/sitefetch` directory exists and you have write permissions
- Verify you have sufficient disk space

## Dependencies

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk): Implementation of the MCP protocol
- [sitefetch](https://github.com/egoist/sitefetch): Tool for fetching entire websites
- [zod](https://github.com/colinhacks/zod): Type validation library

---

Note for developers: This project uses the Model Context Protocol to provide additional context to LLMs like Claude. For more information, refer to the [MCP documentation](https://modelcontextprotocol.io/).
