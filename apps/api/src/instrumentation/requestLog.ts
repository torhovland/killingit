import type { Context, MiddlewareHandler } from "hono";

/**
 * Header carrying the request id. An incoming value is reused so a caller can
 * correlate its own logs with ours; otherwise one is generated per request and
 * echoed on the response, so a client report can be traced to its log line.
 */
const REQUEST_ID_HEADER = "x-request-id";

/** A caller-supplied id is only trusted when it is short and header-safe. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** The severities Cloud Logging recognises on a structured log line. */
type LogSeverity = "INFO" | "WARNING" | "ERROR";

/** One serialized line, with the severity it was written at. */
type LogWriter = (severity: LogSeverity, line: string) => void;

export interface RequestLoggerOptions {
  /** Overrides where lines go; tests collect them, production uses the streams. */
  write?: LogWriter | undefined;
}

/**
 * Writes each line to the stream Cloud Run already reads: failures to standard
 * error, everything else to standard output. Cloud Run sets the log entry's
 * severity from the stream when the payload does not carry one, and the payload
 * does, so the stream choice is about convention rather than meaning.
 */
const writeToStream: LogWriter = (severity, line) => {
  const stream = severity === "INFO" ? process.stdout : process.stderr;
  stream.write(`${line}\n`);
};

/**
 * Serializes one line. `severity` and `time` are Cloud Logging's own field
 * names, so Cloud Run parses the line into a structured payload and a reader
 * can filter or sort it on those fields. Everything else is ours.
 */
function logLine(
  severity: LogSeverity,
  event: string,
  fields: Record<string, unknown>,
): string {
  return JSON.stringify({
    severity,
    time: new Date().toISOString(),
    event,
    ...fields,
  });
}

/** A 5xx is our failure, a 4xx is the caller's, and the rest is routine. */
function severityForStatus(status: number): LogSeverity {
  if (status >= 500) return "ERROR";
  if (status >= 400) return "WARNING";
  return "INFO";
}

/**
 * The error a handler threw, in the shape a reader wants: the message to read
 * and the stack to locate it. A thrown value that is not an `Error` never
 * reaches this middleware, because Hono's error handler only runs for `Error`.
 */
function errorFields(error: Error | undefined): Record<string, unknown> | null {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}

/**
 * Reuses a valid request id from the caller and generates one otherwise. The
 * generated id is a UUID, so two requests never share a line's identity.
 */
function requestIdFor(c: Context): string {
  const supplied = c.req.header(REQUEST_ID_HEADER);
  return supplied !== undefined && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

/**
 * Logs one JSON object per request: severity, time, event, request id, method,
 * path, status and duration, plus the error when a handler threw. The query
 * string, headers and body are never logged, so an address search or an
 * athlete's text stays out of the logs.
 */
export function requestLogger(
  options: RequestLoggerOptions = {},
): MiddlewareHandler {
  const write = options.write ?? writeToStream;
  return async (c, next) => {
    const requestId = requestIdFor(c);
    c.header(REQUEST_ID_HEADER, requestId);
    const startedAt = performance.now();
    await next();

    const status = c.res.status;
    const severity = severityForStatus(status);
    const error = errorFields(c.error);
    write(
      severity,
      logLine(severity, "request", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Math.round(performance.now() - startedAt),
        ...(error === null ? {} : { error }),
      }),
    );
  };
}
