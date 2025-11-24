import { FilesDatabaseProvider } from "./types";
import { AppwriteFilesProvider } from "./providers/appwrite-files";
import { AzureFilesProvider } from "./providers/azure-files";

/**
 * Factory function to get the appropriate files database provider
 * based on environment configuration
 */
export function getFilesDatabaseProvider(): FilesDatabaseProvider {
  const provider = process.env.FILES_DATABASE_PROVIDER || "appwrite";

  switch (provider) {
    case "azure":
      if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
        throw new Error(
          "AZURE_STORAGE_CONNECTION_STRING is required when FILES_DATABASE_PROVIDER=azure"
        );
      }
      return new AzureFilesProvider();

    case "appwrite":
    default:
      return new AppwriteFilesProvider();
  }
}
