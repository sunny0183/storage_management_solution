/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  FilesDatabaseProvider,
  FileMetadata,
  FileFilters,
  SpaceUsageSummary,
} from "../types";
import { TableClient, AzureNamedKeyCredential, TableEntity, TableEntityResult } from "@azure/data-tables";

export class AzureFilesProvider implements FilesDatabaseProvider {
  private filesTable: TableClient;

  constructor() {
    const accountName = this.extractFromConnectionString("AccountName");
    const accountKey = this.extractFromConnectionString("AccountKey");
    const credential = new AzureNamedKeyCredential(accountName, accountKey);

    this.filesTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      "files",
      credential
    );
  }

  async createFile(file: Omit<FileMetadata, "$id">): Promise<FileMetadata> {
    const fileId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const entity = {
      partitionKey: file.owner, // Partition by owner for efficient queries
      rowKey: fileId,
      type: file.type,
      name: file.name,
      url: file.url,
      extension: file.extension,
      size: file.size,
      owner: file.owner, // Store owner as explicit property
      accountId: file.accountId,
      users: JSON.stringify(file.users), // Store array as JSON string
      bucketFileId: file.bucketFileId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.filesTable.createEntity(entity);

    return {
      $id: fileId,
      ...file,
      $createdAt: timestamp,
      $updatedAt: timestamp,
    };
  }

  async getFile(fileId: string): Promise<FileMetadata | null> {
    try {
      // Need to scan since we don't know partitionKey
      const queryIterator = this.filesTable.listEntities({
        queryOptions: { filter: `RowKey eq '${fileId}'` },
      });

      const firstEntity = await queryIterator.next();
      if (!firstEntity.done && firstEntity.value) {
        return this.mapToFile(firstEntity.value);
      }
      return null;
    } catch {
      return null;
    }
  }

  async updateFile(
    fileId: string,
    updates: Partial<FileMetadata>
  ): Promise<FileMetadata> {
    // Get existing file to find partitionKey
    const existing = await this.getFile(fileId);
    if (!existing) throw new Error("File not found");

    const entity: TableEntity = {
      partitionKey: existing.owner,
      rowKey: fileId,
      updatedAt: new Date().toISOString(),
    };

    // Apply updates
    if (updates.name !== undefined) entity.name = updates.name;
    if (updates.users !== undefined)
      entity.users = JSON.stringify(updates.users);
    if (updates.url !== undefined) entity.url = updates.url;

    await this.filesTable.updateEntity(entity, "Merge");

    return { ...existing, ...updates, $updatedAt: entity.updatedAt as string };
  }

  async deleteFile(fileId: string): Promise<void> {
    // Get existing file to find partitionKey
    const existing = await this.getFile(fileId);
    if (!existing) return;

    await this.filesTable.deleteEntity(existing.owner, fileId);
  }

  async listFiles(filters: FileFilters): Promise<{
    documents: FileMetadata[];
    total: number;
  }> {
    let query = "";

    // Build Azure Table Storage filter query
    // If we have owner, use partition key for efficient query
    if (filters.owner && !filters.sharedWith) {
      query = `PartitionKey eq '${filters.owner}'`;
    } else if (filters.owner && filters.sharedWith) {
      // For OR condition (owner OR sharedWith), start with owner partition
      query = `PartitionKey eq '${filters.owner}'`;
    }
    // If only sharedWith (no owner), need to scan all - leave query empty

    const queryIterator = this.filesTable.listEntities({
      queryOptions: query ? { filter: query } : undefined,
    });

    let files: FileMetadata[] = [];
    for await (const entity of queryIterator) {
      const file = this.mapToFile(entity);

      // Apply OR logic: include if owner matches OR sharedWith matches
      const matchesOwner = filters.owner && file.owner === filters.owner;
      const matchesSharedWith = filters.sharedWith && file.users.includes(filters.sharedWith);

      // If both filters specified, file must match at least one (OR logic)
      if (filters.owner || filters.sharedWith) {
        if (!matchesOwner && !matchesSharedWith) {
          continue;
        }
      }
      if (
        filters.types &&
        filters.types.length > 0 &&
        !filters.types.includes(file.type)
      ) {
        continue;
      }
      if (
        filters.searchText &&
        !file.name.toLowerCase().includes(filters.searchText.toLowerCase())
      ) {
        continue;
      }

      files.push(file);
    }

    // Apply sorting
    if (filters.sort) {
      files.sort((a, b) => {
        const aVal = (a as unknown as Record<string, unknown>)[filters.sort!.field];
        const bVal = (b as unknown as Record<string, unknown>)[filters.sort!.field];
        const direction = filters.sort!.direction === "asc" ? 1 : -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * direction;
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal) * direction;
        }
        return 0;
      });
    }

    // Apply limit
    const total = files.length;
    if (filters.limit) {
      files = files.slice(0, filters.limit);
    }

    return { documents: files, total };
  }

  async getTotalSpaceByOwner(ownerId: string): Promise<SpaceUsageSummary> {
    const queryIterator = this.filesTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${ownerId}'` },
    });

    const totalSpace = {
      image: { size: 0, latestDate: "" },
      document: { size: 0, latestDate: "" },
      video: { size: 0, latestDate: "" },
      audio: { size: 0, latestDate: "" },
      other: { size: 0, latestDate: "" },
      used: 0,
      all: 2 * 1024 * 1024 * 1024,
    };

    for await (const entity of queryIterator) {
      const file = this.mapToFile(entity);
      const fileType = file.type as FileType;
      totalSpace[fileType].size += file.size;
      totalSpace.used += file.size;

      if (
        !totalSpace[fileType].latestDate ||
        new Date(file.$updatedAt!) > new Date(totalSpace[fileType].latestDate)
      ) {
        totalSpace[fileType].latestDate = file.$updatedAt!;
      }
    }

    return totalSpace;
  }

  private mapToFile(entity: TableEntityResult<Record<string, unknown>>): FileMetadata {
    return {
      $id: entity.rowKey as string,
      type: entity.type as FileType,
      name: entity.name as string,
      url: entity.url as string,
      extension: entity.extension as string,
      size: entity.size as number,
      owner: (entity.owner || entity.partitionKey) as string, // Use owner field if present, fallback to partitionKey
      accountId: entity.accountId as string,
      users: JSON.parse((entity.users as string) || "[]"),
      bucketFileId: entity.bucketFileId as string,
      $createdAt: entity.createdAt as string,
      $updatedAt: (entity.updatedAt || entity.createdAt) as string,
    };
  }

  private extractFromConnectionString(key: string): string {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
    const regex = new RegExp(`${key}=([^;]+)`);
    const match = connectionString.match(regex);
    if (!match) {
      throw new Error(`Could not extract ${key} from connection string`);
    }
    return match[1];
  }
}
