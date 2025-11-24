import { StorageProvider, StorageConfig } from "./types";
import { AppwriteStorageProvider } from "./providers/appwrite-storage";
import { AzureBlobStorageProvider } from "./providers/azure-storage";

/**
 * Get storage configuration from environment variables
 */
function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || "appwrite") as
    | "appwrite"
    | "azure";

  return {
    provider,
    azure: {
      sasTokenExpiryHours: parseInt(
        process.env.AZURE_SAS_TOKEN_EXPIRY_HOURS || "1",
        10
      ),
    },
  };
}

/**
 * Factory function to get the appropriate storage provider
 * based on environment configuration
 */
export function getStorageProvider(): StorageProvider {
  const config = getStorageConfig();

  switch (config.provider) {
    case "azure":
      if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
        throw new Error(
          "AZURE_STORAGE_CONNECTION_STRING is required when STORAGE_PROVIDER=azure"
        );
      }
      if (!process.env.AZURE_STORAGE_CONTAINER_NAME) {
        throw new Error(
          "AZURE_STORAGE_CONTAINER_NAME is required when STORAGE_PROVIDER=azure"
        );
      }
      return new AzureBlobStorageProvider(config.azure!);

    case "appwrite":
    default:
      return new AppwriteStorageProvider();
  }
}
