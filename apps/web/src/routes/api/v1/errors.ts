export const ErrorCodes = {
  UNAUTHORIZED: { status: 401, code: 'UNAUTHORIZED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  MAP_NOT_FOUND: { status: 404, code: 'MAP_NOT_FOUND' },
  LAYER_NOT_FOUND: { status: 404, code: 'LAYER_NOT_FOUND' },
  ANNOTATION_NOT_FOUND: { status: 404, code: 'ANNOTATION_NOT_FOUND' },
  COMMENT_NOT_FOUND: { status: 404, code: 'COMMENT_NOT_FOUND' },
  FILE_NOT_FOUND: { status: 404, code: 'FILE_NOT_FOUND' },
  VALIDATION_ERROR: { status: 422, code: 'VALIDATION_ERROR' },
  LIMIT_EXCEEDED: { status: 422, code: 'LIMIT_EXCEEDED' },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT' },
  QUOTA_EXCEEDED: { status: 413, code: 'QUOTA_EXCEEDED' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED' },
  INTERNAL_ERROR: { status: 500, code: 'INTERNAL_ERROR' },
} as const;

type ErrorCode = keyof typeof ErrorCodes;

export function toErrorResponse(code: ErrorCode, message?: string): Response {
  const def = ErrorCodes[code];
  return new Response(
    JSON.stringify({
      error: {
        code: def.code,
        message: message ?? def.code,
        status: def.status,
      },
    }),
    {
      status: def.status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
