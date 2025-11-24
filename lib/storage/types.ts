/**
 * Storage abstraction layer types
 * Allows switching between Appwrite and Azure storage providers
 */

export interface UploadResult {
  fileId: string; // Unique identifier (Azure blob name or Appwrite bucketFileId)
  fileName: string;
  fileSize: number;
}

export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param file File to upload
   * @returns Upload result with fileId, fileName, and fileSize
   */
  uploadFile(file: File): Promise<UploadResult>;

  /**
   * Delete a file from storage
   * @param fileId Unique file identifier
   */
  deleteFile(fileId: string): Promise<void>;

  /**
   * Get URL for viewing file in browser
   * @param fileId Unique file identifier
   * @returns URL for viewing the file
   */
  getFileUrl(fileId: string): string;

  /**
   * Get URL for downloading file
   * @param fileId Unique file identifier
   * @returns URL for downloading the file
   */
  getDownloadUrl(fileId: string): string;
}

export interface StorageConfig {
  provider: "appwrite" | "azure";
  // Azure-specific config
  azure?: {
    sasTokenExpiryHours: number; // How long SAS URLs remain valid
  };
}
