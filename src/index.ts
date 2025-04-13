import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import os from "os";

// Promisified exec function
const execAsync = promisify(exec);

// Using ~/.cache/sitefetch directory
const CACHE_DIR = path.join(os.homedir(), ".cache", "sitefetch");

// Path to metadata file
const METADATA_FILE = path.join(CACHE_DIR, "sitefetch_metadata.json");

// Initialization: Create cache directory and metadata file
async function initializeStorage() {
  try {
    // Check if cache directory exists, create if not
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Check if metadata file exists, create empty metadata if not
    try {
      await fs.access(METADATA_FILE);
    } catch {
      await fs.writeFile(METADATA_FILE, JSON.stringify({}), "utf-8");
    }

    console.error(`Storage initialized at: ${CACHE_DIR}`);
  } catch (error) {
    console.error("Failed to initialize storage:", error);
  }
}

// Generate filename from URL
const getFileNameFromUrl = (url: string): string => {
  const hash = crypto.createHash("md5").update(url).digest("hex");
  return `${hash}.txt`;
};

// Get file path
const getFilePath = (url: string): string => {
  return path.join(CACHE_DIR, getFileNameFromUrl(url));
};

// Load metadata
async function loadMetadata(): Promise<Record<string, { url: string, fetchedAt: string, title?: string }>> {
  try {
    const data = await fs.readFile(METADATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading metadata:", error);
    return {};
  }
}

// Save metadata
async function saveMetadata(metadata: Record<string, { url: string, fetchedAt: string, title?: string }>): Promise<void> {
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), "utf-8");
}

// Extract title from content
function extractTitle(content: string): string {
  const titleMatch = content.match(/<title>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }
  return "No title found";
}

// Fetch site information
async function fetchSite(url: string, forceRefresh = false): Promise<string> {
  const filePath = getFilePath(url);
  const fileHash = getFileNameFromUrl(url);

  // Load metadata
  const metadata = await loadMetadata();

  // If file exists and no force refresh, use existing file
  if (!forceRefresh) {
    try {
      await fs.access(filePath);
      console.error(`Using cached content for: ${url}`);
      return await fs.readFile(filePath, "utf-8");
    } catch {
      // Continue if file not found
    }
  }

  try {
    console.error(`Fetching site: ${url}`);

    // Execute sitefetch
    console.error(`Running: npx sitefetch "${url}" -o "${filePath}" --concurrency 10`);
    await execAsync(`npx sitefetch "${url}" -o "${filePath}" --concurrency 10`);

    // Read the result
    const content = await fs.readFile(filePath, "utf-8");

    // Extract title
    const title = extractTitle(content);

    // Update metadata
    metadata[fileHash] = {
      url: url,
      fetchedAt: new Date().toISOString(),
      title: title
    };

    await saveMetadata(metadata);

    return content;
  } catch (error) {
    console.error("Failed to fetch site:", error);
    throw new Error(`Failed to fetch site: ${error}`);
  }
}

// Create MCP server
const server = new McpServer({
  name: "SiteFetch MCP Server",
  version: "1.0.0"
}, {
  // Enable context capability
  capabilities: {
    context: {}
  }
});

// Helper to add content to context
async function addToContext(url: string, content: string, extra: any) {
  try {
    const encodedUrl = encodeURIComponent(url);
    const resourceUri = `sitefetch://${encodedUrl}`;

    // Send a context/add notification to the client
    if (extra.sendNotification) {
      await extra.sendNotification({
        method: "notifications/context/add",
        params: {
          resources: [{
            uri: resourceUri,
            title: `Web content: ${url}`,
            type: "text/plain"
          }]
        }
      });

      console.error(`Added ${url} to context with URI: ${resourceUri}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to add to context:", error);
    return false;
  }
}

// Add enhanced site fetch tool
server.tool(
  "fetch-site",
  "Fetch a website and optionally add it to context",
  {
    url: z.string().url(),
    forceRefresh: z.boolean().optional(),
    addToContext: z.boolean().optional()
  },
  async ({ url, forceRefresh = false, addToContext: shouldAddToContext = true }, extra) => {
    try {
      const content = await fetchSite(url, forceRefresh);
      const encodedUrl = encodeURIComponent(url);
      const resourceUri = `sitefetch://${encodedUrl}`;

      let responseText = `Successfully fetched site content from ${url}.\n\n`;
      let addedToContext = false;

      if (shouldAddToContext) {
        // Try to add to context
        addedToContext = await addToContext(url, content, extra);

        if (addedToContext) {
          responseText += `Content added to your context. You can refer to information from this site in your queries.\n\n`;
        } else {
          responseText += `Failed to add content to context automatically.\n`;
        }
      }

      responseText += `Resource URI: ${resourceUri}\n` +
                     `Content length: ${content.length} characters\n` +
                     `Stored at: ${getFilePath(url)}\n\n`;

      if (!addedToContext) {
        responseText += `To add this content to your context, use the add-to-context tool with this URL.`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Add dedicated tool to add fetched content to context
server.tool(
  "add-to-context",
  "Add previously fetched site to the conversation context",
  {
    url: z.string().url()
  },
  async ({ url }, extra) => {
    try {
      const filePath = getFilePath(url);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        return {
          content: [{
            type: "text",
            text: `Error: Content for ${url} not found. Please fetch it first with fetch-site.`
          }],
          isError: true
        };
      }

      const content = await fs.readFile(filePath, "utf-8");
      const addedToContext = await addToContext(url, content, extra);

      if (addedToContext) {
        return {
          content: [
            {
              type: "text",
              text: `Added content from ${url} to your context.\n` +
                   `Content length: ${content.length} characters\n` +
                   `You can now reference this information in your conversation.`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add content to context. This may be due to client limitations.\n` +
                   `The content is available at resource URI: sitefetch://${encodeURIComponent(url)}`
            }
          ],
          isError: true
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Provide site content as a resource with improved listing
server.resource(
  "site-content",
  new ResourceTemplate("sitefetch://{url}", {
    list: async (extra) => {
      // List all available fetched sites
      const metadata = await loadMetadata();
      return {
        resources: Object.entries(metadata).map(([hash, data]) => ({
          name: data.title || data.url,
          uri: `sitefetch://${encodeURIComponent(data.url)}`,
          description: `Fetched: ${data.fetchedAt}`
        }))
      };
    }
  }),
  {
    description: "Fetched website content",
    mimeType: "text/plain"
  },
  async (uri, { url }, extra) => {
    try {
      // Handle array or string values appropriately
      const urlValue = Array.isArray(url) ? url[0] : url;
      const decodedUrl = decodeURIComponent(urlValue);

      const content = await fetchSite(decodedUrl);

      // Add a hint for adding to context
      const contextHint = `\n\n---\nTo add this content to your conversation context, use: add-to-context ${decodedUrl}`;

      return {
        contents: [{
          uri: uri.href,
          text: content + contextHint,
          mimeType: "text/plain"
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch site: ${errorMessage}`);
    }
  }
);

// Enhanced tool to display site list with more metadata
server.tool(
  "list-sites",
  "List all fetched websites",
  {},
  async () => {
    try {
      const metadata = await loadMetadata();
      const entries = Object.entries(metadata);

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: "No sites have been fetched yet. Use fetch-site to retrieve website content." }]
        };
      }

      const siteList = entries.map(([hash, data], index) => {
        const { url, fetchedAt, title } = data;
        const filePath = getFilePath(url);
        const encodedUrl = encodeURIComponent(url);
        const fileSize = fs.stat(filePath).then(stat => stat.size).catch(() => "unknown");

        return `${index + 1}. ${title || url}\n   URL: ${url}\n   Resource: sitefetch://${encodedUrl}\n   Fetched: ${fetchedAt}\n   File: ${filePath}`;
      });

      return {
        content: [{
          type: "text",
          text: `Fetched sites:\n\n${(await Promise.all(siteList)).join('\n\n')}\n\nTo add any of these to your context, use: add-to-context <url>`
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error listing sites: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Cache clear tool
server.tool(
  "clear-cache",
  "Clear all cached website content",
  {},
  async () => {
    try {
      const metadata = await loadMetadata();
      const count = Object.keys(metadata).length;

      // Delete all files registered in metadata
      for (const [hash, data] of Object.entries(metadata)) {
        const filePath = getFilePath(data.url);
        try {
          await fs.unlink(filePath);
          console.error(`Deleted file: ${filePath}`);
        } catch (error) {
          console.error(`Failed to delete file ${filePath}:`, error);
        }
      }

      // Clear metadata
      await saveMetadata({});

      return {
        content: [{
          type: "text",
          text: `Cleared cache for ${count} sites.`
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error clearing cache: ${errorMessage}` }],
        isError: true
      };
    }
  }
);

// Initialize before starting the server
await initializeStorage();

// Connect using STDIO transport
const transport = new StdioServerTransport();
await server.connect(transport);
