import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "http";
import mongoose from "mongoose";
import { ConnectMongoDB } from "./connection.js";
import {
  setupDailyEmailCron,
  triggerDailyEmailsNow,
} from "./cron/dailyEmailJob.js";
import { registerRoutes } from "./routes/register.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import seedAdmin from "./seeder/admin.js";
import { initSockets } from "./services/socket.js";
import cron from "node-cron";

// ✅ Import enhanced logger and crash tracker
import { logger, CrashTracker, getCurrentDate } from "./utils/logger.js";
import { randomizeDiscoverIndexes } from "./services/discoverRandomizer.js";

dotenv.config();

// 🚨 Check for previous crashes on startup
const previousCrash = CrashTracker.checkForPreviousCrash();
if (previousCrash.hasCrash) {
  logger.crash(
    "🚨 PREVIOUS CRASH DETECTED ON LAST STARTUP",
    null,
    previousCrash
  );
  console.log("\n⚠️  ⚠️  ⚠️  PREVIOUS SERVER CRASH DETECTED ⚠️  ⚠️  ⚠️");
  console.log(`Last crash: ${previousCrash.lastCrashTime}`);
  console.log("Check logs/server-crashes.log for details\n");
}

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT;

// 📊 Performance monitoring middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.request(req, res, duration);
    
    // Log slow requests
    if (duration > 5000) {
      logger.warn(`Slow request detected: ${req.method} ${req.url}`, {
        duration: `${duration}ms`,
        ip: req.ip
      });
    }
  });
  
  next();
});

// ✅ Log server start with system info
logger.server(`🚀 Server starting on port ${PORT}`, {
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
  environment: process.env.NODE_ENV || "development",
  memory: process.memoryUsage(),
  uptime: process.uptime(),
  port: PORT,
  timestamp: new Date().toISOString()
});

// Middlewares
app.use(cors());

// webhooks - IMPORTANT: Register webhook routes BEFORE json middleware
app.use("/api/stripe", webhookRoutes);

// Preserve raw body for webhook, but use json for rest
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// ✅ Increase timeout for long-running requests
server.timeout = 120000; // 2 minutes
server.headersTimeout = 120000;

// 🚨 GLOBAL ERROR HANDLERS - CRASH PREVENTION & LOGGING
process.on("uncaughtException", (error) => {
  const crashContext = {
    type: "uncaughtException",
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    pid: process.pid,
    argv: process.argv,
    platform: process.platform,
    nodeVersion: process.version
  };
  
  logger.crash("🆘 UNCAUGHT EXCEPTION - SERVER WILL CRASH", error, crashContext);
  
  console.error("\n" + "=".repeat(80));
  console.error("🆘 FATAL ERROR - SERVER CRASHING");
  console.error(`Error: ${error.message}`);
  console.error(`Check: logs/server-crashes.log for complete details`);
  console.error("=".repeat(80) + "\n");
  
  // Give time to write logs
  setTimeout(() => {
    process.exit(1);
  }, 2000);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("🆘 UNHANDLED PROMISE REJECTION", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise
  });
});

// ✅ MongoDB connection with enhanced logging
const startMongoTime = Date.now();
try {
  logger.info("🔗 Connecting to MongoDB...");
  await ConnectMongoDB();
  const duration = Date.now() - startMongoTime;
  logger.database("connect", "MongoDB", {}, duration, { connected: true });
  logger.info(`✅ MongoDB connected in ${duration}ms`);
} catch (error) {
  logger.crash("❌ MongoDB connection failed", error, {
    operation: "database_connection",
    duration: Date.now() - startMongoTime
  });
  process.exit(1);
}

// ✅ Seed admin with monitoring
try {
  const startSeedTime = Date.now();
  logger.info("👑 Seeding admin user...");
  await seedAdmin();
  const duration = Date.now() - startSeedTime;
  logger.info(`✅ Admin user seeded in ${duration}ms`);
} catch (error) {
  logger.error("❌ Admin seeding failed", error);
}

// ✅ Register routes
try {
  logger.info("🛣️  Registering routes...");
  registerRoutes(app);
  logger.info("✅ Routes registered successfully");
} catch (error) {
  logger.error("❌ Route registration failed", error);
}

// ✅ Initialize sockets
try {
  logger.info("🔌 Initializing sockets...");
  initSockets(server);
  logger.info("✅ Sockets initialized");
} catch (error) {
  logger.error("❌ Socket initialization failed", error);
}

// ✅ Cron jobs with enhanced logging
try {
  // Discover randomizer cron
  cron.schedule("0 3 * * *", async () => {
    const jobStart = Date.now();
    try {
      logger.cron("discover-randomizer", "🔄 Starting discover indexes randomization...");
      await randomizeDiscoverIndexes();
      const duration = Date.now() - jobStart;
      logger.cron("discover-randomizer", `✅ Completed in ${duration}ms`);
    } catch (err) {
      logger.error("❌ Discover randomizer cron failed", err);
    }
  });
  logger.info("📅 Discover randomizer scheduled (daily at 3 AM)");

  // Daily email cron
  setupDailyEmailCron();
  logger.info("📅 Daily email cron scheduled");
  
  // Log cleanup cron (every Sunday at 2 AM)
  cron.schedule("0 2 * * 0", () => {
    logger.cron("log-cleanup", "🧹 Cleaning old log files...");
    logger.cleanupOldLogs(30); // Keep 30 days of logs
  });
} catch (error) {
  logger.error("❌ Cron job setup failed", error);
}

// ✅ Manual trigger for daily emails
app.get("/api/admin/send-daily-emails", async (req, res) => {
  const startTime = Date.now();
  logger.info("📧 Manual daily email trigger requested", {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  try {
    const result = await triggerDailyEmailsNow();
    const duration = Date.now() - startTime;
    
    logger.performance("manual-email-trigger", duration, {
      emailsSent: result.emailsSent || 0,
      errors: result.errors || 0
    });

    res.json({
      success: true,
      message: "Daily emails triggered manually",
      data: result,
      duration: `${duration}ms`,
      logs: `Check logs/server-${getCurrentDate()}.log for details`
    });
  } catch (error) {
    logger.error("❌ Manual email trigger failed", error);
    res.status(500).json({
      success: false,
      message: error.message,
      logFile: `logs/server-${getCurrentDate()}.log`
    });
  }
});

// ✅ Enhanced Health check endpoint
app.get("/api/health", (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    lastCrash: previousCrash.hasCrash ? previousCrash.lastCrashTime : null,
    logFiles: {
      daily: `server-${getCurrentDate()}.log`,
      errors: `errors-${getCurrentDate()}.log`,
      crashes: 'server-crashes.log',
      startup: 'server-startup.log'
    }
  };
  
  logger.info("Health check requested", { ip: req.ip });
  res.json(health);
});

// ✅ Server status endpoint
app.get("/api/admin/server-status", (req, res) => {
  const status = {
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform
    },
    database: {
      status: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      host: mongoose.connection.host,
      name: mongoose.connection.name
    },
    logs: {
      directory: './logs/',
      current: `server-${getCurrentDate()}.log`,
      crashLog: 'server-crashes.log',
      lastCrash: previousCrash.lastCrashTime || 'No recent crashes'
    },
    environment: process.env.NODE_ENV || 'development'
  };
  
  res.json(status);
});

// ✅ Start server
server.listen(PORT, () => {
  logger.server(`✅ Server running on port ${PORT}`, {
    url: `http://localhost:${PORT}`,
    pid: process.pid,
    environment: process.env.NODE_ENV
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 SERVER STARTED SUCCESSFULLY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`📅 ${new Date().toLocaleString()}`);
  console.log(`📁 Logs: ./logs/`);
  console.log(`🔍 Health: http://localhost:${PORT}/api/health`);
  console.log(`📊 Status: http://localhost:${PORT}/api/admin/server-status`);
  
  if (previousCrash.hasCrash) {
    console.log(`\n⚠️  Previous crash detected at: ${previousCrash.lastCrashTime}`);
    console.log(`   Check: logs/server-crashes.log`);
  }
  console.log(`${'='.repeat(60)}\n`);
});

// ✅ Graceful shutdown with logging
const gracefulShutdown = (signal) => {
  logger.server(`🛑 Received ${signal}, shutting down gracefully...`, {
    signal,
    uptime: process.uptime()
  });

  server.close(() => {
    logger.server("✅ HTTP server closed");
    
    mongoose.connection.close(false, () => {
      logger.server("✅ MongoDB connection closed");
      logger.server("👋 Server shutdown complete");
      process.exit(0);
    });
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.crash("⚠️  Forcing shutdown after timeout", null, {
      signal,
      timeout: 10000
    });
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown('SIGTERM'));
process.on("SIGINT", () => gracefulShutdown('SIGINT'));