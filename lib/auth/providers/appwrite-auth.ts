import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { appwriteConfig } from "@/lib/appwrite/config";
import { Query, ID } from "node-appwrite";
import { cookies } from "next/headers";
import { avatarPlaceholderUrl } from "@/constants";
import type { AuthProvider, UserMetadata } from "../types";

/**
 * Appwrite Auth Provider
 * Wraps existing Appwrite authentication logic
 */
export class AppwriteAuthProvider implements AuthProvider {
  // ==================== USER MANAGEMENT ====================

  async createUser(email: string, fullName: string): Promise<UserMetadata> {
    const { databases } = await createAdminClient();
    const accountId = crypto.randomUUID(); // Generate ID for consistency

    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.usersCollectionId,
      ID.unique(),
      {
        fullName,
        email,
        avatar: avatarPlaceholderUrl,
        accountId,
      }
    );

    return {
      $id: doc.$id,
      email: doc.email,
      fullName: doc.fullName,
      avatar: doc.avatar,
      accountId: doc.accountId,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    };
  }

  async getUserByEmail(email: string): Promise<UserMetadata | null> {
    try {
      const { databases } = await createAdminClient();

      const result = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.usersCollectionId,
        [Query.equal("email", [email])]
      );

      if (result.total === 0) return null;

      const user = result.documents[0];
      return {
        $id: user.$id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        accountId: user.accountId,
        $createdAt: user.$createdAt,
        $updatedAt: user.$updatedAt,
      };
    } catch {
      return null;
    }
  }

  async getUserById(userId: string): Promise<UserMetadata | null> {
    try {
      const { databases } = await createAdminClient();

      const result = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.usersCollectionId,
        [Query.equal("accountId", [userId])]
      );

      if (result.total === 0) return null;

      const user = result.documents[0];
      return {
        $id: user.$id,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        accountId: user.accountId,
        $createdAt: user.$createdAt,
        $updatedAt: user.$updatedAt,
      };
    } catch {
      return null;
    }
  }

  // ==================== OTP FLOW ====================

  async sendEmailOTP(email: string): Promise<{ sessionId: string }> {
    const { account } = await createAdminClient();

    // Check if user exists, create if not
    let user = await this.getUserByEmail(email);
    if (!user) {
      // Extract name from email for new users
      const name = email.split("@")[0].replace(/[._-]/g, " ");
      const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
      user = await this.createUser(email, capitalizedName);
    }

    // Send OTP via Appwrite
    const session = await account.createEmailToken(ID.unique(), email);

    return { sessionId: session.userId };
  }

  async verifySecret(sessionId: string, otp: string): Promise<{ userId: string }> {
    const { account } = await createAdminClient();

    // Verify OTP with Appwrite
    const session = await account.createSession(sessionId, otp);

    // Set Appwrite session cookie
    (await cookies()).set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    // Get user by accountId
    const user = await this.getUserById(session.userId);
    if (!user) throw new Error("User not found");

    return { userId: user.accountId };
  }

  // ==================== SESSION MANAGEMENT ====================

  async createSession(): Promise<void> {
    // Session already created in verifySecret for Appwrite
    // This method is a no-op for Appwrite provider
  }

  async getCurrentUser(): Promise<UserMetadata | null> {
    try {
      const { databases, account } = await createSessionClient();

      const result = await account.get();

      const user = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.usersCollectionId,
        [Query.equal("accountId", [result.$id])]
      );

      if (user.total === 0) return null;

      const userData = user.documents[0];
      return {
        $id: userData.$id,
        email: userData.email,
        fullName: userData.fullName,
        avatar: userData.avatar,
        accountId: userData.accountId,
        $createdAt: userData.$createdAt,
        $updatedAt: userData.$updatedAt,
      };
    } catch {
      return null;
    }
  }

  async signOutUser(): Promise<void> {
    const { account } = await createSessionClient();

    await account.deleteSession("current");
    (await cookies()).delete("appwrite-session");
  }
}
