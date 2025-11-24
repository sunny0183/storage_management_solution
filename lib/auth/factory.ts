import type { AuthProvider } from "./types";
import { AppwriteAuthProvider } from "./providers/appwrite-auth";
import { AzureAuthProvider } from "./providers/azure-auth";

/**
 * Get the configured auth provider
 * Toggle between Appwrite and Azure auth via AUTH_PROVIDER environment variable
 * 
 * @returns AuthProvider instance (Appwrite or Azure)
 */
export function getAuthProvider(): AuthProvider {
  const provider = process.env.AUTH_PROVIDER || "appwrite";

  switch (provider.toLowerCase()) {
    case "azure":
      return new AzureAuthProvider();
    case "appwrite":
      return new AppwriteAuthProvider();
    default:
      console.warn(`Unknown AUTH_PROVIDER: ${provider}. Falling back to Appwrite.`);
      return new AppwriteAuthProvider();
  }
}
