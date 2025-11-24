/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FilesDatabaseProvider,
  FileMetadata,
  FileFilters,
  SpaceUsageSummary,
} from "../types";
import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID, Query, Models } from "node-appwrite";

export class AppwriteFilesProvider implements FilesDatabaseProvider {
  async createFile(file: Omit<FileMetadata, "$id">): Promise<FileMetadata> {
    const { databases } = await createAdminClient();
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      ID.unique(),
      file
    );
    return this.mapToFile(doc);
  }

  async getFile(fileId: string): Promise<FileMetadata | null> {
    const { databases } = await createAdminClient();
    try {
      const doc = await databases.getDocument(
        appwriteConfig.databaseId,
        appwriteConfig.filesCollectionId,
        fileId
      );
      return this.mapToFile(doc);
    } catch {
      return null;
    }
  }

  async updateFile(
    fileId: string,
    updates: Partial<FileMetadata>
  ): Promise<FileMetadata> {
    const { databases } = await createAdminClient();
    const doc = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId,
      updates
    );
    return this.mapToFile(doc);
  }

  async deleteFile(fileId: string): Promise<void> {
    const { databases } = await createAdminClient();
    await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId
    );
  }

  async listFiles(filters: FileFilters): Promise<{
    documents: FileMetadata[];
    total: number;
  }> {
    const { databases } = await createAdminClient();
    const queries = this.buildQueries(filters);

    const result = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      queries
    );

    return {
      documents: result.documents.map((doc) => this.mapToFile(doc)),
      total: result.total,
    };
  }

  async getTotalSpaceByOwner(ownerId: string): Promise<SpaceUsageSummary> {
    const { databases } = await createSessionClient();
    const files = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      [Query.equal("owner", [ownerId])]
    );

    const totalSpace = {
      image: { size: 0, latestDate: "" },
      document: { size: 0, latestDate: "" },
      video: { size: 0, latestDate: "" },
      audio: { size: 0, latestDate: "" },
      other: { size: 0, latestDate: "" },
      used: 0,
      all: 2 * 1024 * 1024 * 1024,
    };

    files.documents.forEach((file) => {
      const fileType = file.type as FileType;
      totalSpace[fileType].size += file.size;
      totalSpace.used += file.size;

      if (
        !totalSpace[fileType].latestDate ||
        new Date(file.$updatedAt) > new Date(totalSpace[fileType].latestDate)
      ) {
        totalSpace[fileType].latestDate = file.$updatedAt;
      }
    });

    return totalSpace;
  }

  private buildQueries(filters: FileFilters): string[] {
    const queries: string[] = [];

    if (filters.owner || filters.sharedWith) {
      const conditions = [];
      if (filters.owner) {
        conditions.push(Query.equal("owner", [filters.owner]));
      }
      if (filters.sharedWith) {
        conditions.push(Query.contains("users", [filters.sharedWith]));
      }
      queries.push(Query.or(conditions));
    }

    if (filters.types && filters.types.length > 0) {
      queries.push(Query.equal("type", filters.types));
    }

    if (filters.searchText) {
      queries.push(Query.contains("name", filters.searchText));
    }

    if (filters.limit) {
      queries.push(Query.limit(filters.limit));
    }

    if (filters.sort) {
      queries.push(
        filters.sort.direction === "asc"
          ? Query.orderAsc(filters.sort.field)
          : Query.orderDesc(filters.sort.field)
      );
    }

    return queries;
  }

  private mapToFile(doc: Models.Document): FileMetadata {
    return {
      $id: doc.$id,
      type: doc.type,
      name: doc.name,
      url: doc.url,
      extension: doc.extension,
      size: doc.size,
      owner: doc.owner,
      accountId: doc.accountId,
      users: doc.users,
      bucketFileId: doc.bucketFileId,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    };
  }
}
