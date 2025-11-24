import { StorageProvider, UploadResult } from "../types";
import { createAdminClient } from "@/lib/appwrite";
import { InputFile } from "node-appwrite/file";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID } from "node-appwrite";

/**
 * Appwrite Storage Provider
 * Wraps existing Appwrite storage operations
 * Server-side only - uses Node.js fs module via InputFile
 */
export class AppwriteStorageProvider implements StorageProvider {
  async uploadFile(file: File): Promise<UploadResult> {
    const { storage } = await createAdminClient();

    const inputFile = InputFile.fromBuffer(file, file.name);

    const bucketFile = await storage.createFile(
      appwriteConfig.bucketId,
      ID.unique(),
      inputFile
    );

    return {
      fileId: bucketFile.$id,
      fileName: bucketFile.name,
      fileSize: bucketFile.sizeOriginal,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const { storage } = await createAdminClient();
    await storage.deleteFile(appwriteConfig.bucketId, fileId);
  }

  getFileUrl(fileId: string): string {
    return `${process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT}/storage/buckets/${process.env.NEXT_PUBLIC_APPWRITE_BUCKET}/files/${fileId}/view?project=${process.env.NEXT_PUBLIC_APPWRITE_PROJECT}`;
  }

  getDownloadUrl(fileId: string): string {
    return `${process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT}/storage/buckets/${process.env.NEXT_PUBLIC_APPWRITE_BUCKET}/files/${fileId}/download?project=${process.env.NEXT_PUBLIC_APPWRITE_PROJECT}`;
  }
}
