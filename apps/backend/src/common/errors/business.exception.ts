import type {
  BusinessError,
  BusinessErrorCode,
} from "./business-error-catalog";

export type BusinessExceptionOptions = {
  readonly message?: string;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
};

export class BusinessException extends Error {
  readonly code: BusinessErrorCode;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    readonly error: BusinessError,
    options: BusinessExceptionOptions = {},
  ) {
    super(options.message ?? error.message);
    this.name = BusinessException.name;
    this.code = error.code;
    this.cause = options.cause;
    this.context = options.context;
  }
}

export function isBusinessException(
  error: unknown,
  code?: BusinessErrorCode,
): error is BusinessException {
  return (
    error instanceof BusinessException &&
    (code === undefined || error.code === code)
  );
}
