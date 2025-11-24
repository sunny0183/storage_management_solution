/**
 * Authentication abstraction layer types
 * Supports both Appwrite and Azure auth providers
 */

export interface UserMetadata {
  $id: string;
  email: string;
  fullName: string;
  avatar: string;
  accountId: string;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface OTPSession {
  sessionId: string;
  email: string;
  otp: string;
  expiresAt: number;
  verified: boolean;
  createdAt: string;
}

export interface EmailTemplate {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Auth provider interface
 * All auth providers must implement these methods
 */
export interface AuthProvider {
  // User management
  createUser(email: string, fullName: string): Promise<UserMetadata>;
  getUserByEmail(email: string): Promise<UserMetadata | null>;
  getUserById(userId: string): Promise<UserMetadata | null>;

  // OTP authentication flow
  sendEmailOTP(email: string): Promise<{ sessionId: string }>;
  verifySecret(sessionId: string, otp: string): Promise<{ userId: string }>;

  // Session management
  createSession(userId: string): Promise<void>;
  getCurrentUser(): Promise<UserMetadata | null>;
  signOutUser(): Promise<void>;
}
