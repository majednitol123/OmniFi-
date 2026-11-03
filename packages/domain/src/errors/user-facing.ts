import { OmniFiError } from './base';

export interface UserNotification {
  readonly title: string;
  readonly message: string;
  readonly action?: string | undefined;
  readonly type: 'info' | 'warning' | 'error';
}

/**
 * Transforms an error into an actionable, jargon-free UI notification.
 */
export function toUserMessage(error: unknown): UserNotification {
  if (error instanceof OmniFiError) {
    let type: 'info' | 'warning' | 'error' = 'warning';
    if (error.severity === 'info') type = 'info';
    if (error.severity === 'critical') type = 'error';

    return {
      title: getTitleForCode(error.code),
      message: error.userMessage,
      action: error.recoveryAction,
      type,
    };
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('user rejected') || msg.includes('user denied')) {
      return {
        title: 'Transaction Cancelled',
        message: 'You cancelled the transaction in your wallet.',
        type: 'info',
      };
    }
    return {
      title: 'Unexpected Error',
      message: error.message,
      action: 'Please try again or check your network connection.',
      type: 'error',
    };
  }

  return {
    title: 'Unexpected Error',
    message: 'An unknown error occurred while processing your request.',
    action: 'Please refresh and try again.',
    type: 'error',
  };
}

function getTitleForCode(code: number): string {
  if (code >= 5000 && code < 5100) return 'Swap Unsuccessful';
  if (code >= 4000 && code < 4100) return 'Quote Unavailable';
  if (code >= 6000 && code < 6100) return 'Position Error';
  if (code >= 3000 && code < 3100) return 'Token Warning';
  if (code >= 2000 && code < 2100) return 'Network Problem';
  return 'Transaction Error';
}

