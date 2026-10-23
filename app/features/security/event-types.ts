export const SECURITY_EVENT_TYPES = {
  loginSuccess: "login_success",
  loginFailed: "login_failed",
  accountCreated: "account_created",
  accountDisabled: "account_disabled",
  accountEnabled: "account_enabled",
  accountDeleted: "account_deleted",
  passwordChanged: "password_changed",
  passwordReset: "password_reset",
  roleChanged: "role_changed",
  serviceConnected: "service_connected",
  serviceDisconnected: "service_disconnected",
  sessionRevoked: "session_revoked",
  forceUnlock: "force_unlock",
} as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES];

export const SECURITY_EVENT_LABELS: Record<SecurityEventType, string> = {
  login_success: "Successful login",
  login_failed: "Failed login",
  account_created: "Account created",
  account_disabled: "Account disabled",
  account_enabled: "Account enabled",
  account_deleted: "Account deleted",
  password_changed: "Password changed",
  password_reset: "Password reset",
  role_changed: "Role changed",
  service_connected: "Service connected",
  service_disconnected: "Service disconnected",
  session_revoked: "Session revoked",
  force_unlock: "Force unlock",
};

export function securityEventLabel(eventType: string): string {
  // `in` would also match inherited Object.prototype keys ("toString",
  // "constructor"), returning a function instead of a string. Check own keys only.
  if (Object.prototype.hasOwnProperty.call(SECURITY_EVENT_LABELS, eventType)) {
    return SECURITY_EVENT_LABELS[eventType as SecurityEventType];
  }
  return eventType.replaceAll("_", " ");
}
