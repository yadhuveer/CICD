// src/utils/logger.ts
import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize, errors } = format;

// Define log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `[${timestamp}] ${level}: ${stack || message}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    colorize(), // colorize output (dev)
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }), // include error stack
    logFormat,
  ),
  transports: [
    new transports.Console(),
    // Optional file logging for production:
    // new transports.File({ filename: "logs/error.log", level: "error" }),
    // new transports.File({ filename: "logs/combined.log" }),
  ],
  exitOnError: false,
});

export default logger;
