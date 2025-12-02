import { config } from "dotenv";
import { join } from "path";
import { object, string, number } from "joi";
config({ path: join(__dirname, "../../.env") });

const envVarsSchema = object()
  .keys({
    NODE_ENV: string().valid("production", "development", "test").required(),
    PORT: number().default(8000),
    MONGODB_URL: string().required().description("Mongo DB url"),
    // REDIS_HOST: string().description("Redis host"),
    // REDIS_PORT: number().description("Redis port"),
    // REDIS_PASSWORD: string().description("Redis password"),
    FRONTEND_URL: string().required().description("Frontend url"),
    CORS_ALLOWED: string().required().description("CORS allowed origins"),

    ADMIN_EMAIL: string().required().description("Admin email"),

    JWT_SECRET: string().required().description("JWT secret key"),
    JWT_ACCESS_EXPIRATION_MINUTES: number()
      .default(30)
      .description("minutes after which access token expires"),
    JWT_REFRESH_EXPIRATION_DAYS: number()
      .default(30)
      .description("days after which refresh token expires"),

    MAGIC_LINK_EXPIRATION_MINUTES: number()
      .default(30)
      .description("minutes after which magic link expires"),
    OTP_EXPIRATION_MINUTES: number().default(5).description("minutes after which OTP expires"),

    // SENDGRID_API_KEY: Joi.string().required().description("Sendgrid API key"),
    // SENDGRID_FROM_EMAIL: Joi.string().required().description("Sendgrid from email"),
    // SENDGRID_FROM_NAME: Joi.string().required().description("Sendgrid from name"),

    // GOOGLE_CLIENT_ID: Joi.string().required().description("Google client ID"),

    // LOGTAIL_API_KEY: Joi.string().required().description("API key for Logtail"),
    // LOGTAIL_INGESTING_HOST: Joi.string().required().description("Logtail ingestion host"),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: "key" } })
  .validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = envVars.NODE_ENV;
export const port = envVars.PORT;
export const frontend_url = envVars.FRONTEND_URL;
export const admin = {
  email: envVars.ADMIN_EMAIL,
};
export const mongoose = {
  url: envVars.MONGODB_URL,
  options: {},
};
export const jwt = {
  secret: envVars.JWT_SECRET,
  accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
  refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
};
export const magic_link = {
  expirationMinutes: envVars.MAGIC_LINK_EXPIRATION_MINUTES,
};
export const otp = {
  expirationMinutes: envVars.OTP_EXPIRATION_MINUTES,
};
export const redis = {
  host: envVars.REDIS_HOST,
  port: envVars.REDIS_PORT,
  url: `redis://${envVars.REDIS_HOST}:${envVars.REDIS_PORT}`,
  password: envVars.REDIS_PASSWORD,
};
export const cors = {
  allowedOrigins: envVars.CORS_ALLOWED,
};
export const email = {
  sendgridApiKey: envVars.SENDGRID_API_KEY,
  fromEmail: envVars.SENDGRID_FROM_EMAIL,
  fromName: envVars.SENDGRID_FROM_NAME,
};
export const google = {
  clientId: envVars.GOOGLE_CLIENT_ID,
};
export const logtail = {
  apiKey: envVars.LOGTAIL_API_KEY,
  endpoint: `https://${envVars.LOGTAIL_INGESTING_HOST}`,
};
