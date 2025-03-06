import dotenv from "dotenv";
import chalk from "chalk";
import zlib from "zlib";
import express, { Request, Response, NextFunction } from "express";
import { createProxyMiddleware, Options } from "http-proxy-middleware";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Load environment variables from .env file
dotenv.config();

// Get target RPC URL from environment variable
const TARGET_URL = process.env.TARGET_URL;
if (!TARGET_URL) {
  console.error("Please set TARGET_URL in your environment variables");
  process.exit(1);
}

// Create log directory if it doesn't exist
const LOG_DIR = path.join(__dirname, "../logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

const app = express();

// Function to create a unique log filename for each request
function createLogFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uniqueId = uuidv4().substring(0, 8);
  return path.join(LOG_DIR, `logs-${timestamp}-${uniqueId}.log`);
}

// Middleware to log requests and responses
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestStartTime = new Date();
  const requestTime = requestStartTime.toISOString();
  const requestBody = req.body;
  const originalWrite = res.write;
  const originalEnd = res.end;
  const chunks: Buffer[] = [];

  // Override write method
  res.write = function (chunk: any, ...args: any[]): boolean {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return originalWrite.apply(this, arguments as any);
  };

  // Override end method
  res.end = function (chunk: any, ...args: any[]): Response {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const responseBuffer = Buffer.concat(chunks);
    const responseTime = new Date().toISOString();
    const responseHeaders = res.getHeaders();
    const processedResponse = handleResponse(responseBuffer, responseHeaders);

    // Create a single log entry with all request details
    const logEntry = {
      timestamp: {
        request: requestTime,
        response: responseTime,
        duration: `${new Date().getTime() - requestStartTime.getTime()}ms`,
      },
      request: {
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: requestBody,
      },
      response: {
        statusCode: res.statusCode,
        headers: responseHeaders,
        body: processedResponse.json || processedResponse.text,
      },
    };

    // Create a new log file for this request
    const logFilename = createLogFilename();

    // Write to the log file
    fs.writeFileSync(logFilename, JSON.stringify(logEntry, null, 2));

    // Single consolidated log to console
    const outputText = processedResponse.json
      ? JSON.stringify(processedResponse.json, null, 2)
      : processedResponse.text;

    console.log(
      chalk.blue(`[${requestTime}] ${req.method} ${req.path}`) +
        (requestBody && requestBody.method
          ? "\n" + chalk.green(`Method: ${requestBody.method}`)
          : "") +
        "\n" +
        chalk.red(`Response status: ${res.statusCode}`) +
        "\n" +
        chalk.gray(`Response body: ${outputText}`) +
        "\n" +
        chalk.yellow(
          `Duration: ${new Date().getTime() - requestStartTime.getTime()}ms`
        ) +
        "\n" +
        chalk.cyan(`Log saved to: ${logFilename}`)
    );

    // Call original end and return this for chaining
    originalEnd.apply(this, arguments as any);
    return this;
  };

  next();
});

// Function to handle response - decompression and parsing
function handleResponse(buffer: Buffer, headers: Record<string, any> = {}) {
  try {
    // Check for compression
    const contentEncoding = headers["content-encoding"]?.toLowerCase();

    // Decompress if needed
    let decompressedBuffer = buffer;
    if (contentEncoding === "gzip") {
      try {
        decompressedBuffer = zlib.gunzipSync(buffer);
      } catch (error) {
        console.error(
          chalk.yellow("Failed to decompress gzipped response"),
          error
        );
      }
    }

    // Convert to string
    const responseText = decompressedBuffer.toString("utf8");

    // Try to parse as JSON
    try {
      return { text: responseText, json: JSON.parse(responseText) };
    } catch (e) {
      return { text: responseText, json: null };
    }
  } catch (error) {
    console.error(chalk.red("Error processing response"), error);
    return { text: "Error processing response", json: null };
  }
}

// Create and configure proxy
const rpcProxy = createProxyMiddleware({
  target: TARGET_URL,
  changeOrigin: true,
  // Error handling
  onError: (err, req, res) => {
    console.error("Proxy error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Proxy error" },
          id: req.body?.id || null,
        })
      );
    }
  },
} as Options);

// Apply proxy to all routes
app.use("/", rpcProxy);

// Start the proxy server
const PORT = process.env.PROXY_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Proxying requests to: ${TARGET_URL}`);
  console.log(`Logs stored in: ${LOG_DIR}`);
});
