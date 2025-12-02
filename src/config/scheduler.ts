import cron from "node-cron";
import { executeForm4FullPipeline } from "../services/form4FullPipeline.service.js";
import logger from "../utils/logger.js";

/**
 * =====================================
 * CRON JOB SCHEDULER
 * =====================================
 * Centralized scheduler for all automated pipeline tasks
 *
 * This follows the Single Responsibility Principle (SRP) by
 * focusing solely on scheduling and executing recurring tasks.
 *
 * IMPORTANT: All cron jobs are disabled by default and must be
 * explicitly enabled via environment variables for safety.
 */

// =====================================
// CONFIGURATION
// =====================================

type CronJobConfig = {
  name: string;
  schedule: string;
  enabled: boolean;
  description: string;
  task: () => Promise<void>;
};

// =====================================
// FORM 4 PIPELINE CRON JOB
// =====================================

/**
 * Form 4 Full Pipeline Cron Job
 * Environment Variables:
 * - ENABLE_FORM4_CRON: "true" to enable this job
 * - FORM4_CRON_SCHEDULE: Override default schedule (e.g., "0 *\/6 * * *" for every 6 hours)
 * - FORM4_CRON_SCRAPE_LIMIT: Number of Form 4s to scrape per run (default: 20)
 */
const form4PipelineJob: CronJobConfig = {
  name: "Form 4 Full Pipeline",
  schedule: process.env.FORM4_CRON_SCHEDULE || "* * * * *", // default: every minute
  enabled: process.env.ENABLE_FORM4_CRON === "true",
  description: "Scrape latest Form 4s from SEC and enrich with contact data",
  task: async () => {
    try {
      logger.info(`\n${"=".repeat(80)}`);
      logger.info(`⏰ CRON JOB TRIGGERED: Form 4 Full Pipeline`);
      logger.info(`   Timestamp: ${new Date().toISOString()}`);
      logger.info(`${"=".repeat(80)}\n`);

      const scrapeLimit = parseInt(process.env.FORM4_CRON_SCRAPE_LIMIT || "20", 10);

      // Main Pipeline Execution function
      const result = await executeForm4FullPipeline({
        scrapeLimit,
      });

      if (result.success) {
        logger.info(`✅ CRON JOB COMPLETED: Form 4 Full Pipeline`);
        logger.info(`   Signals Scraped: ${result.signalIds.length}`);
        logger.info(`   Enrichments Successful: ${result.enrichmentResults.successful}`);
        logger.info(`   Contacts Created: ${result.enrichmentResults.contactsCreated}`);
        logger.info(`   Contacts Matched: ${result.enrichmentResults.contactsMatched}`);
      } else {
        logger.error(`❌ CRON JOB FAILED: Form 4 Full Pipeline`);
        logger.error(`   Error: ${result.error}`);
      }
    } catch (error: any) {
      logger.error(`❌ CRON JOB ERROR: Form 4 Full Pipeline`);
      logger.error(`   Error: ${error.message}`);
      logger.error(error);
    }
  },
};

// =====================================
// CRON JOB REGISTRY
// =====================================

/**
 * All configured cron jobs
 * Add new jobs to this array as needed
 */
const cronJobs: CronJobConfig[] = [
  form4PipelineJob,
  // Add more cron jobs here in the future:
  // schedule13DPipelineJob,
  // maEventsPipelineJob,
  // etc.
];

// =====================================
// SCHEDULER INITIALIZATION
// =====================================

/**
 * Initialize and start all enabled cron jobs
 *
 * This function should be called once when the server starts
 * (typically in server.ts after database connection)
 */
export const initializeScheduler = (): void => {
  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`📅 INITIALIZING CRON SCHEDULER`);
  logger.info(`${"=".repeat(80)}\n`);

  let enabledCount = 0;
  let disabledCount = 0;

  cronJobs.forEach((job) => {
    if (job.enabled) {
      // Validate cron schedule format
      if (!cron.validate(job.schedule)) {
        logger.error(`❌ Invalid cron schedule for "${job.name}": ${job.schedule}`);
        logger.error(`   Job will not be scheduled.`);
        return;
      }

      // Schedule the job
      cron.schedule(job.schedule, job.task, {
        timezone: process.env.CRON_TIMEZONE || "America/New_York", // Default to EST
      });

      logger.info(`✅ Cron job enabled: ${job.name}`);
      logger.info(`   Schedule: ${job.schedule}`);
      logger.info(`   Description: ${job.description}`);
      logger.info(`   Timezone: ${process.env.CRON_TIMEZONE || "America/New_York"}\n`);

      enabledCount++;
    } else {
      logger.info(`⏸️  Cron job disabled: ${job.name}`);
      logger.info(`   Schedule: ${job.schedule}`);
      logger.info(`   Description: ${job.description}`);
      logger.info(
        `   To enable: Set ENABLE_${job.name.toUpperCase().replace(/ /g, "_")}_CRON=true in .env\n`,
      );

      disabledCount++;
    }
  });

  logger.info(`${"=".repeat(80)}`);
  logger.info(`📅 SCHEDULER INITIALIZATION COMPLETE`);
  logger.info(`   Total Jobs: ${cronJobs.length}`);
  logger.info(`   Enabled: ${enabledCount}`);
  logger.info(`   Disabled: ${disabledCount}`);
  logger.info(`${"=".repeat(80)}\n`);
};

/**
 * Manually trigger a specific cron job
 * Useful for testing or admin operations.
 */
export const triggerCronJob = async (jobName: string): Promise<void> => {
  const job = cronJobs.find((j) => j.name === jobName);

  if (!job) {
    throw new Error(`Cron job not found: ${jobName}`);
  }

  logger.info(`MANUALLY TRIGGERING: ${jobName}`);
  await job.task();
};
