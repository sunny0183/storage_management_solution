import { StorageProvider, UploadResult } from "../types";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from "@azure/storage-blob";

/**
 * Azure Blob Storage Provider
 * Implements storage operations using Azure Blob Storage
 * Server-side only
 */
export class AzureBlobStorageProvider implements StorageProvider {
  private containerClient;
  private sharedKeyCredential: StorageSharedKeyCredential;
  private sasTokenExpiryHours: number;

  constructor(config: { sasTokenExpiryHours: number }) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME!;
    this.sasTokenExpiryHours = config.sasTokenExpiryHours;

    // Parse connection string to extract account name and key
    const accountName = this.extractFromConnectionString(
      connectionString,
      "AccountName"
    );
    const accountKey = this.extractFromConnectionString(
      connectionString,
      "AccountKey"
    );

    this.sharedKeyCredential = new StorageSharedKeyCredential(
      accountName,
      accountKey
    );

    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = blobServiceClient.getContainerClient(containerName);
  }

  private extractFromConnectionString(
    connectionString: string,
    key: string
  ): string {
    const regex = new RegExp(`${key}=([^;]+)`);
    const match = connectionString.match(regex);
    if (!match) {
      throw new Error(`Could not extract ${key} from connection string`);
    }
    return match[1];
  }

  async uploadFile(file: File): Promise<UploadResult> {
    // Generate unique blob name: timestamp-uuid-filename
    const timestamp = Date.now();
    const uuid = crypto.randomUUID();
    const blobName = `${timestamp}-${uuid}-${file.name}`;

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload with metadata
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: file.type || "application/octet-stream",
        blobContentDisposition: `inline; filename="${file.name}"`,
      },
      metadata: {
        originalFileName: file.name,
        uploadTimestamp: timestamp.toString(),
      },
    });

    return {
      fileId: blobName,
      fileName: file.name,
      fileSize: file.size,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(fileId);
    await blockBlobClient.delete();
  }

  getFileUrl(fileId: string): string {
    return this.generateSasUrl(fileId, "r"); // Read permission for viewing
  }

  getDownloadUrl(fileId: string): string {
    return this.generateSasUrl(fileId, "r"); // Read permission for downloading
  }

  /**
   * Generate a SAS URL with specified permissions
   * @param blobName The blob name
   * @param permissions Permission string ("r" for read, "rw" for read-write)
   * @returns Complete URL with SAS token
   */
  private generateSasUrl(blobName: string, permissions: string): string {
    const startsOn = new Date();
    const expiresOn = new Date(
      startsOn.getTime() + this.sasTokenExpiryHours * 60 * 60 * 1000
    );

    const sasOptions = {
      containerName: this.containerClient.containerName,
      blobName,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn,
      expiresOn,
    };

    const sasToken = generateBlobSASQueryParameters(
      sasOptions,
      this.sharedKeyCredential
    ).toString();

    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    return `${blockBlobClient.url}?${sasToken}`;
  }
}
