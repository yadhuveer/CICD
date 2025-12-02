import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import logger from "./utils/logger.js";
import connectDB from "./config/db.js";
import { initializeScheduler } from "./config/scheduler.js";

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT}`);
    });

    // Initialize cron jobs after successful database connection
    initializeScheduler();
  })
  .catch((error) => {
    logger.error(`MongoDB connection Error ${error}`);
  });
