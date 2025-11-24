import {
  TableClient,
  AzureNamedKeyCredential,
  TableEntityResult,
} from "@azure/data-tables";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AuthProvider, UserMetadata, EmailTemplate } from "../types";

/**
 * Azure Auth Provider
 * Uses Azure Table Storage for users and OTP sessions
 * Uses JWT in HTTP-only cookies for session management
 */
export class AzureAuthProvider implements AuthProvider {
  private usersTable: TableClient;
  private otpTable: TableClient;
  private jwtSecret: Uint8Array;

  constructor() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING!;
    const accountName = this.extractFromConnectionString(connStr, "AccountName");
    const accountKey = this.extractFromConnectionString(connStr, "AccountKey");
    const credential = new AzureNamedKeyCredential(accountName, accountKey);

    this.usersTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      "users",
      credential
    );

    this.otpTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      "otpsessions", // Alphanumeric only
      credential
    );

    // JWT secret from environment (no Azure Key Vault)
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters long");
    }
    this.jwtSecret = new TextEncoder().encode(secret);
  }

  private extractFromConnectionString(connectionString: string, key: string): string {
    const regex = new RegExp(`${key}=([^;]+)`);
    const match = connectionString.match(regex);
    if (!match) {
      throw new Error(`Could not extract ${key} from connection string`);
    }
    return match[1];
  }

  // ==================== USER MANAGEMENT ====================

  async createUser(email: string, fullName: string): Promise<UserMetadata> {
    const userId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Generate avatar URL (using ui-avatars.com)
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&size=200&background=random`;

    const entity = {
      partitionKey: this.getEmailDomain(email), // Shard by domain
      rowKey: userId,
      email,
      fullName,
      avatar: avatarUrl,
      accountId: userId, // Same as userId for simplicity
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.usersTable.createEntity(entity);

    return {
      $id: userId,
      email,
      fullName,
      avatar: avatarUrl,
      accountId: userId,
      $createdAt: timestamp,
      $updatedAt: timestamp,
    };
  }

  async getUserByEmail(email: string): Promise<UserMetadata | null> {
    try {
      const entities = this.usersTable.listEntities({
        queryOptions: { filter: `email eq '${email}'` },
      });

      const iterator = entities[Symbol.asyncIterator]();
      const { value, done } = await iterator.next();
      if (!done && value) {
        return this.mapToUser(value);
      }

      return null;
    } catch {
      return null;
    }
  }

  async getUserById(userId: string): Promise<UserMetadata | null> {
    try {
      const entities = this.usersTable.listEntities({
        queryOptions: { filter: `RowKey eq '${userId}'` },
      });

      const iterator = entities[Symbol.asyncIterator]();
      const { value, done } = await iterator.next();
      if (!done && value) {
        return this.mapToUser(value);
      }

      return null;
    } catch {
      return null;
    }
  }

  // ==================== OTP FLOW ====================

  async sendEmailOTP(email: string): Promise<{ sessionId: string }> {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store in Azure Table
    await this.otpTable.createEntity({
      partitionKey: email,
      rowKey: sessionId,
      otp,
      expiresAt,
      verified: false,
      createdAt: new Date().toISOString(),
    });

    // Prepare email template for future use
    const emailTemplate = this.prepareOTPEmail(email, otp);

    // Log to console for testing (instead of sending email)
    console.log("\n" + "=".repeat(50));
    console.log("📧 OTP EMAIL (Console Log - For Testing)");
    console.log("=".repeat(50));
    console.log(`To: ${emailTemplate.to}`);
    console.log(`Subject: ${emailTemplate.subject}`);
    console.log(`\nOTP Code: ${otp}`);
    console.log(`Session ID: ${sessionId}`);
    console.log(`Expires: ${new Date(expiresAt).toLocaleString()}`);
    console.log("=".repeat(50) + "\n");

    // TODO: Implement email sending
    // await sendEmail(emailTemplate);

    return { sessionId };
  }

  async verifySecret(sessionId: string, otp: string): Promise<{ userId: string }> {
    // Query by sessionId (RowKey)
    const entities = this.otpTable.listEntities({
      queryOptions: { filter: `RowKey eq '${sessionId}'` },
    });

    let validSession: TableEntityResult<Record<string, unknown>> | null = null;

    for await (const entity of entities) {
      if (
        entity.otp === otp &&
        !entity.verified &&
        Date.now() < (entity.expiresAt as number)
      ) {
        validSession = entity;
        break;
      }
    }

    if (!validSession) {
      throw new Error("Invalid or expired OTP");
    }

    // Mark as verified
    await this.otpTable.updateEntity(
      {
        partitionKey: validSession.partitionKey as string,
        rowKey: sessionId,
        verified: true,
      },
      "Merge"
    );

    // Get or create user
    const email = validSession.partitionKey as string;
    let user = await this.getUserByEmail(email);

    if (!user) {
      // Create new user (extract name from email)
      const name = email.split("@")[0].replace(/[._-]/g, " ");
      const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
      user = await this.createUser(email, capitalizedName);
    }

    return { userId: user.$id };
  }

  // ==================== SESSION MANAGEMENT ====================

  async createSession(userId: string): Promise<void> {
    // Create JWT token
    const token = await new SignJWT({ userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(this.jwtSecret);

    // Set HTTP-only cookie
    (await cookies()).set("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });
  }

  async getCurrentUser(): Promise<UserMetadata | null> {
    try {
      const token = (await cookies()).get("session")?.value;
      if (!token) return null;

      const { payload } = await jwtVerify(token, this.jwtSecret);
      return this.getUserById(payload.userId as string);
    } catch {
      return null;
    }
  }

  async signOutUser(): Promise<void> {
    (await cookies()).delete("session");
  }

  // ==================== HELPERS ====================

  private getEmailDomain(email: string): string {
    // Extract domain for partitioning (e.g., gmail.com, yahoo.com)
    const domain = email.split("@")[1] || "unknown";
    return domain;
  }

  private mapToUser(entity: TableEntityResult<Record<string, unknown>>): UserMetadata {
    return {
      $id: entity.rowKey as string,
      email: entity.email as string,
      fullName: entity.fullName as string,
      avatar: entity.avatar as string,
      accountId: entity.accountId as string,
      $createdAt: entity.createdAt as string,
      $updatedAt: (entity.updatedAt || entity.createdAt) as string,
    };
  }

  private prepareOTPEmail(email: string, otp: string): EmailTemplate {
    return {
      to: email,
      subject: "Your verification code",
      text: `Your verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                  <tr>
                    <td style="padding: 40px 30px; text-align: center;">
                      <h1 style="margin: 0 0 20px; color: #333; font-size: 24px;">Verification Code</h1>
                      <p style="margin: 0 0 30px; color: #666; font-size: 16px;">
                        Enter this code to continue:
                      </p>
                      <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; margin: 0 0 30px;">
                        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #333;">
                          ${otp}
                        </div>
                      </div>
                      <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
                        This code will expire in <strong>10 minutes</strong>.
                      </p>
                      <p style="margin: 0; color: #999; font-size: 12px;">
                        If you didn't request this code, please ignore this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    };
  }
}
