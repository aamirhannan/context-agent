class AppError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.details = details;
  }
}

class ValidationError extends AppError { constructor(m, d) { super(m, 400, d); } }
class NotFoundError extends AppError { constructor(m, d) { super(m, 404, d); } }
class UpstreamError extends AppError { constructor(m, d) { super(m, 502, d); } }
class LlmError extends AppError { constructor(m, d) { super(m, 503, d); } }

class PipelineError extends AppError {
  constructor(cause, trace) {
    super(cause.message, cause.status || 500, { stage: trace?.at(-1)?.stage });
    this.cause = cause;
    this.trace = trace;
  }
}

module.exports = { AppError, ValidationError, NotFoundError, UpstreamError, LlmError, PipelineError };
