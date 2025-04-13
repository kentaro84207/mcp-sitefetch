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
async function loadMetadata(): Promise<Record<string, { url: string, fetchedAt: string }>> {
  try {
    const data = await fs.readFile(METADATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading metadata:", error);
    return {};
  }
}

// Save metadata
async function saveMetadata(metadata: Record<string, { url: string, fetchedAt: string }>): Promise<void> {
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), "utf-8");
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

    // Update metadata
    metadata[fileHash] = {
      url: url,
      fetchedAt: new Date().toISOString()
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
});

// Add site fetch tool
server.tool(
  "fetch-site",
  {
    url: z.string().url(),
    forceRefresh: z.boolean().optional()
  },
  async ({ url, forceRefresh = false }) => {
    try {
      const content = await fetchSite(url, forceRefresh);
      const encodedUrl = encodeURIComponent(url);

      return {
        content: [
          {
            type: "text",
            text: `Successfully fetched site content from ${url}.\n\n` +
                 `The content is available as a resource at sitefetch://${encodedUrl}\n\n` +
                 `Content length: ${content.length} characters\n` +
                 `Stored at: ${getFilePath(url)}`
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

// Provide site content as a resource
server.resource(
  "site-content",
  new ResourceTemplate("sitefetch://{url}", { list: undefined }),
  async (uri, { url }) => {
    try {
      // Handle array or string values appropriately
      const urlValue = Array.isArray(url) ? url[0] : url;
      const decodedUrl = decodeURIComponent(urlValue);

      const content = await fetchSite(decodedUrl);

      return {
        contents: [{
          uri: uri.href,
          text: content,
          mimeType: "text/plain"
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch site: ${errorMessage}`);
    }
  }
);

// Tool to display site list
server.tool(
  "list-sites",
  {},
  async () => {
    try {
      const metadata = await loadMetadata();
      const entries = Object.entries(metadata);

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: "No sites have been fetched yet." }]
        };
      }

      const siteList = entries.map(([hash, data], index) => {
        const { url, fetchedAt } = data;
        const filePath = getFilePath(url);
        const encodedUrl = encodeURIComponent(url);

        return `${index + 1}. ${url}\n   Resource: sitefetch://${encodedUrl}\n   Fetched: ${fetchedAt}\n   File: ${filePath}`;
      });

      return {
        content: [{
          type: "text",
          text: `Fetched sites:\n\n${siteList.join('\n\n')}`
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
