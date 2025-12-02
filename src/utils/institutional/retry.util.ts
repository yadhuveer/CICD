export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
};

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ECONNREFUSED",
    "ABORTED",
    "429",
    "500",
    "502",
    "503",
    "504",
  ],
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableError = (error: any, retryableErrors: string[]): boolean => {
  if (!error) return false;
  const errorString = error.toString().toUpperCase();
  const errorCode = error.code?.toString().toUpperCase();
  const statusCode = error.response?.status?.toString();

  return retryableErrors.some((retryable) => {
    const retryableUpper = retryable.toUpperCase();
    return (
      errorString.includes(retryableUpper) ||
      errorCode === retryableUpper ||
      statusCode === retryable
    );
  });
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  _context?: string,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === opts.maxAttempts;
      const shouldRetry = isRetryableError(error, opts.retryableErrors);

      if (isLastAttempt || !shouldRetry) {
        throw error;
      }

      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelayMs,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
