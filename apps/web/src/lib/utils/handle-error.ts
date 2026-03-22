import type { TRPCClientError } from '@trpc/client';
import type { AppRouter } from '@repo/api';

/**
 * Extracts a user-friendly error message from various error types.
 * Distinguishes between network errors, auth errors, and generic errors.
 */
export function getUserMessage(
  error: unknown,
): string {
  // Network errors (fetch TypeError with "fetch" in message)
  if (error instanceof TypeError && error.message?.includes('fetch')) {
    return 'Check your connection and try again.';
  }

  // tRPC errors with specific codes
  if (error instanceof Error && 'data' in error && typeof error.data === 'object' && error.data !== null) {
    const data = error.data as { code?: string };
    if (data.code === 'UNAUTHORIZED') {
      return 'You are not logged in. Please sign in and try again.';
    }
    if (data.code === 'FORBIDDEN') {
      return 'You do not have permission to perform this action.';
    }
  }

  // Generic Error with message
  if (error instanceof Error && error.message) {
    // Skip raw stack traces or internal error details
    if (error.message.startsWith('at ') || error.message.includes('node_modules')) {
      return 'An unexpected error occurred. Please try again.';
    }
    return error.message;
  }

  // Fallback for unknown error types
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Logs error details for debugging while showing user-friendly message.
 */
export function handleError(error: unknown): string {
  // Log full error for debugging
  if (error instanceof Error) {
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
  } else {
    console.error('Unknown error:', error);
  }

  return getUserMessage(error);
}
