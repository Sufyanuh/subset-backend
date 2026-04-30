import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const getCurrentDate = () => new Date().toISOString().split("T")[0];
export const getCurrentDateTime = () => new Date().toISOString();

// Crash log file (always append, never overwrite)
const CRASH_LOG_FILE = path.join(logDir, "server-crashes.log");

export class CrashTracker {
  static lastCrashReported = null;

  static checkForPreviousCrash() {
    try {
      if (fs.existsSync(CRASH_LOG_FILE)) {
        const content = fs.readFileSync(CRASH_LOG_FILE, "utf8");
        const lines = content.trim().split("\n");
        const lastCrash = lines[lines.length - 1];

        if (lastCrash && lastCrash.includes("🆘 SERVER CRASHED")) {
          const crashTime = lastCrash.match(/\[(.*?)\]/)?.[1];
          if (crashTime && crashTime !== this.lastCrashReported) {
            this.lastCrashReported = crashTime;
            return {
              hasCrash: true,
              lastCrashTime: crashTime,
              crashLog: lines.slice(-10).join("\n"), // Last 10 lines
            };
          }
        }
      }
    } catch (error) {
      console.error("Error checking crash logs:", error);
    }
    return { hasCrash: false };
  }
}

export const logger = {
  // 📊 Log levels with colors
  levels: {
    SERVER: "🟢 SERVER",
    INFO: "🔵 INFO",
    WARN: "🟡 WARN",
    ERROR: "🔴 ERROR",
    CRASH: "🆘 CRASH",
    REQUEST: "🌐 REQUEST",
    DATABASE: "🗄️  DB",
    CRON: "⏰ CRON",
  },

  // 📝 Write to multiple log files
  writeLog: (level, message, data = null, logToConsole = true) => {
    const timestamp = getCurrentDateTime();
    const dateStr = getCurrentDate();

    // Format log entry
    let logEntry = `[${timestamp}] ${level}: ${message}`;
    if (data) {
      if (data instanceof Error) {
        logEntry += `\n  Error: ${data.message}\n  Stack: ${data.stack}`;
      } else if (typeof data === "object") {
        logEntry += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      } else {
        logEntry += `\n  Data: ${data}`;
      }
    }
    logEntry += "\n" + "─".repeat(80) + "\n";

    // 1. Daily log file
    const dailyLogFile = path.join(logDir, `server-${dateStr}.log`);
    fs.appendFileSync(dailyLogFile, logEntry);

    // 2. Specialized log files
    if (level.includes("CRASH") || level.includes("ERROR")) {
      // Error-specific log
      const errorLogFile = path.join(logDir, `errors-${dateStr}.log`);
      fs.appendFileSync(errorLogFile, logEntry);

      // Permanent crash log (never deleted)
      fs.appendFileSync(CRASH_LOG_FILE, logEntry);
    }

    // 3. Console output (with colors)
    if (logToConsole) {
      const colors = {
        "🟢": "\x1b[32m", // Green
        "🔵": "\x1b[34m", // Blue
        "🟡": "\x1b[33m", // Yellow
        "🔴": "\x1b[31m", // Red
        "🆘": "\x1b[41m\x1b[37m", // Red background
        "🌐": "\x1b[36m", // Cyan
        "🗄️": "\x1b[35m", // Magenta
        "⏰": "\x1b[90m", // Gray
      };

      const color = colors[level.split(" ")[0]] || "\x1b[0m";
      console.log(
        `${color}[${
          timestamp.split("T")[1].split(".")[0]
        }] ${level}: ${message}\x1b[0m`
      );
    }
  },

  // 🚀 Server startup/shutdown
  server: (message, data = null) => {
    logger.writeLog(logger.levels.SERVER, message, data);

    // Also write to startup log
    const startupLog = path.join(logDir, "server-startup.log");
    const entry = `[${getCurrentDateTime()}] ${message}\n`;
    fs.appendFileSync(startupLog, entry);
  },

  // ℹ️ General info
  info: (message, data = null) => {
    logger.writeLog(logger.levels.INFO, message, data);
  },

  // ⚠️ Warnings
  warn: (message, data = null) => {
    logger.writeLog(logger.levels.WARN, message, data);
  },

  // 🚨 Errors
  error: (message, error = null) => {
    const errorData = {
      message: error?.message || message,
      stack: error?.stack,
      code: error?.code,
      status: error?.status,
      ...(error?.response?.data && { response: error.response.data }),
    };

    logger.writeLog(logger.levels.ERROR, message, errorData);
  },

  // 💥 CRASH - Special handler
  crash: (message, error = null, context = {}) => {
    const crashData = {
      ...context,
      error: error?.message,
      stack: error?.stack,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: os.platform(),
      nodeVersion: process.version,
      pid: process.pid,
      argv: process.argv,
    };

    // Write to crash log (special format)
    const crashEntry = `\n${"=".repeat(
      100
    )}\n🆘 SERVER CRASHED - ${getCurrentDateTime()}\n${"=".repeat(100)}\n`;
    fs.appendFileSync(CRASH_LOG_FILE, crashEntry);

    logger.writeLog(logger.levels.CRASH, message, crashData, false);

    // Send email/SMS/notification here (if configured)
    // logger.sendCrashNotification(crashData);
  },

  // 🌐 HTTP Requests
  request: (req, res, duration) => {
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      userId: req.user?._id || "anonymous",
      body: req.body && Object.keys(req.body).length > 0 ? req.body : undefined,
      query:
        req.query && Object.keys(req.query).length > 0 ? req.query : undefined,
    };

    // Don't log sensitive data
    if (logData.body?.password) delete logData.body.password;
    if (logData.body?.token) delete logData.body.token;

    logger.writeLog(
      logger.levels.REQUEST,
      `${req.method} ${req.url} ${res.statusCode} (${duration}ms)`,
      logData
    );
  },

  // 🗄️ Database operations
  database: (operation, collection, query, duration, result = null) => {
    logger.writeLog(logger.levels.DATABASE, `${operation} on ${collection}`, {
      query: query,
      duration: `${duration}ms`,
      resultCount: Array.isArray(result) ? result.length : result ? 1 : 0,
    });
  },

  // ⏰ Cron jobs
  cron: (jobName, message, data = null) => {
    logger.writeLog(logger.levels.CRON, `[${jobName}] ${message}`, data);
  },

  // 📊 Performance monitoring
  performance: (operation, duration, data = {}) => {
    let level = "🔵 INFO";
    if (duration > 1000) level = "🟡 WARN";
    if (duration > 5000) level = "🔴 ERROR";

    logger.writeLog(level, `${operation} took ${duration}ms`, {
      ...data,
      duration,
    });
  },

  // 🧹 Clean old logs (call this periodically)
  cleanupOldLogs: (daysToKeep = 30) => {
    try {
      const files = fs.readdirSync(logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      files.forEach((file) => {
        if (file.startsWith("server-") && file.endsWith(".log")) {
          const dateStr = file.replace("server-", "").replace(".log", "");
          const fileDate = new Date(dateStr);

          if (fileDate < cutoffDate && fileDate.toString() !== "Invalid Date") {
            fs.unlinkSync(path.join(logDir, file));
            logger.info(`Cleaned up old log file: ${file}`);
          }
        }
      });
    } catch (error) {
      logger.error("Failed to cleanup old logs", error);
    }
  },
};
