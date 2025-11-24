"use server";

import { parseStringify } from "@/lib/utils";
import { redirect } from "next/navigation";
import { getAuthProvider } from "@/lib/auth/factory";

const handleError = (error: unknown, message: string) => {
  console.log(error, message);
  throw error;
};

export const sendEmailOTP = async ({ email }: { email: string }) => {
  try {
    const authProvider = getAuthProvider();
    const result = await authProvider.sendEmailOTP(email);
    return result.sessionId;
  } catch (error) {
    handleError(error, "Failed to send email OTP");
  }
};

export const createAccount = async ({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) => {
  try {
    const authProvider = getAuthProvider();

    // Check if user exists
    const existingUser = await authProvider.getUserByEmail(email);

    // Send OTP (creates user if doesn't exist for Azure, just sends OTP for Appwrite)
    const result = await authProvider.sendEmailOTP(email);

    // Create user if doesn't exist (for Appwrite compatibility)
    if (!existingUser) {
      await authProvider.createUser(email, fullName);
    }

    return parseStringify({ accountId: result.sessionId });
  } catch (error) {
    handleError(error, "Failed to create account");
  }
};

export const verifySecret = async ({
  accountId,
  password,
}: {
  accountId: string;
  password: string;
}) => {
  try {
    const authProvider = getAuthProvider();

    // Verify OTP and get user ID
    const result = await authProvider.verifySecret(accountId, password);

    // Create session (sets JWT cookie for Azure, no-op for Appwrite)
    await authProvider.createSession(result.userId);

    return parseStringify({ sessionId: result.userId });
  } catch (error) {
    handleError(error, "Failed to verify OTP");
  }
};

export const getCurrentUser = async () => {
  try {
    const authProvider = getAuthProvider();

    const user = await authProvider.getCurrentUser();

    if (!user) return null;

    return parseStringify(user);
  } catch (error) {
    console.log(error);
    return null;
  }
};

export const signOutUser = async () => {
  try {
    const authProvider = getAuthProvider();

    await authProvider.signOutUser();

    return { success: true };
  } catch (error) {
    handleError(error, "Failed to sign out user");
  } finally {
    redirect("/sign-in");
  }
};

export const signInUser = async ({ email }: { email: string }) => {
  try {
    const authProvider = getAuthProvider();

    // Check if user exists
    const existingUser = await authProvider.getUserByEmail(email);

    // User exists, send OTP
    if (existingUser) {
      const result = await authProvider.sendEmailOTP(email);
      return parseStringify({ accountId: result.sessionId });
    }

    // User doesn't exist
    return parseStringify({ accountId: null, error: "User not found" });
  } catch (error) {
    handleError(error, "Failed to sign in user");
  }
};
