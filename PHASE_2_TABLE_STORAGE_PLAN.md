# Phase 2: Azure Table Storage Migration Plan (Files Table Only)

## Overview

Migrate **files metadata only** from Appwrite Database to Azure Table Storage while keeping users table in Appwrite. This simplifies authentication and user management.

## Current State (After Phase 1)

```
┌─────────────────────────────────────────────┐
│           Next.js Application               │
├─────────────────────────────────────────────┤
│  Server Actions (lib/actions)               │
│  ├─ user.actions.ts                         │
│  └─ file.actions.ts                         │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌────────────────┐  ┌────────────────┐
│ Azure Blob     │  │ Appwrite DB    │
│ Storage        │  │ - users table  │ ← Keep in Appwrite
│ (Files/Blobs)  │  │ - files table  │ ← Migrate to Azure
└────────────────┘  └────────────────┘
```

## Target State (Phase 2)

```
┌─────────────────────────────────────────────┐
│           Next.js Application               │
├─────────────────────────────────────────────┤
│  Server Actions (lib/actions)               │
│  ├─ user.actions.ts → Appwrite DB           │
│  └─ file.actions.ts → Azure Table Storage   │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌────────────────┐  ┌────────────────┐
│ Azure Blob     │  │ Appwrite DB    │
│ Storage        │  │ - users table  │ ✓ Stays
│ (Files/Blobs)  │  └────────────────┘
└────────────────┘
       │            ┌────────────────┐
       │            │ Azure Table    │
       └───────────>│ Storage        │
                    │ - files table  │ ✓ Migrated
                    └────────────────┘
```

## Why Keep Users in Appwrite?

**Benefits:**

- ✅ Appwrite's authentication system stays intact (email OTP, sessions)
- ✅ No need to rebuild user management
- ✅ Simpler migration (only files table)
- ✅ Users table is small and not a performance bottleneck
- ✅ Faster Phase 2 implementation

**Trade-offs:**

- ❌ Still dependent on Appwrite for user management
- ❌ Mixed database architecture (Appwrite + Azure)

**Decision**: This is acceptable because:

1. Users table is small and rarely changes
2. Authentication is complex - not worth rebuilding
3. Can migrate users later if needed
4. Focus on high-value migration (files table)

## Phase 2 Implementation Strategy

### Step 1: Create Database Abstraction Layer (Files Only)

Create abstraction for file metadata operations only.

```typescript
// lib/database/types.ts
export interface FileMetadata {
  $id: string;
  type: FileType;
  name: string;
  url: string;
  extension: string;
  size: number;
  owner: string;
  accountId: string;
  users: string[];
  bucketFileId: string;
  $createdAt?: string;
  $updatedAt?: string;
}

export interface FilesDatabaseProvider {
  // File CRUD operations
  createFile(file: Omit<FileMetadata, "$id">): Promise<FileMetadata>;
  getFile(fileId: string): Promise<FileMetadata | null>;
  updateFile(
    fileId: string,
    updates: Partial<FileMetadata>
  ): Promise<FileMetadata>;
  deleteFile(fileId: string): Promise<void>;

  // Query operations
  listFiles(filters: FileFilters): Promise<{
    documents: FileMetadata[];
    total: number;
  }>;
  getTotalSpaceByOwner(ownerId: string): Promise<SpaceUsageSummary>;
}

export interface FileFilters {
  owner?: string;
  types?: FileType[];
  searchText?: string;
  sharedWith?: string;
  sort?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface SpaceUsageSummary {
  image: { size: number; latestDate: string };
  document: { size: number; latestDate: string };
  video: { size: number; latestDate: string };
  audio: { size: number; latestDate: string };
  other: { size: number; latestDate: string };
  used: number;
  all: number;
}
```

### Step 2: Implement Appwrite Files Provider

Wrap existing Appwrite file operations.

```typescript
// lib/database/providers/appwrite-files.ts
import { FilesDatabaseProvider, FileMetadata, FileFilters } from "../types";
import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID, Query } from "node-appwrite";

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

  private mapToFile(doc: any): FileMetadata {
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
```

### Step 3: Implement Azure Table Storage Files Provider

```typescript
// lib/database/providers/azure-files.ts
import { FilesDatabaseProvider, FileMetadata, FileFilters } from "../types";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

export class AzureFilesProvider implements FilesDatabaseProvider {
  private filesTable: TableClient;

  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = this.extractAccountKey();
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

      for await (const entity of queryIterator) {
        return this.mapToFile(entity);
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

    const entity: any = {
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

    return { ...existing, ...updates, $updatedAt: entity.updatedAt };
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
    if (filters.owner) {
      query = `PartitionKey eq '${filters.owner}'`;
    } else if (filters.sharedWith) {
      // For shared files, need to scan all and filter in-memory
      query = "";
    }

    const queryIterator = this.filesTable.listEntities({
      queryOptions: query ? { filter: query } : undefined,
    });

    let files: FileMetadata[] = [];
    for await (const entity of queryIterator) {
      const file = this.mapToFile(entity);

      // Additional filtering
      if (filters.sharedWith && !file.users.includes(filters.sharedWith)) {
        continue;
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
        const aVal = (a as any)[filters.sort!.field];
        const bVal = (b as any)[filters.sort!.field];
        const direction = filters.sort!.direction === "asc" ? 1 : -1;
        return aVal > bVal ? direction : -direction;
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

  private mapToFile(entity: any): FileMetadata {
    return {
      $id: entity.rowKey,
      type: entity.type,
      name: entity.name,
      url: entity.url,
      extension: entity.extension,
      size: entity.size,
      owner: entity.partitionKey,
      accountId: entity.accountId,
      users: JSON.parse(entity.users || "[]"),
      bucketFileId: entity.bucketFileId,
      $createdAt: entity.createdAt,
      $updatedAt: entity.updatedAt || entity.createdAt,
    };
  }

  private extractAccountKey(): string {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
    const match = connectionString.match(/AccountKey=([^;]+)/);
    if (!match) throw new Error("Could not extract AccountKey");
    return match[1];
  }
}
```

### Step 4: Create Files Database Factory

```typescript
// lib/database/factory.ts
import { FilesDatabaseProvider } from "./types";
import { AppwriteFilesProvider } from "./providers/appwrite-files";
import { AzureFilesProvider } from "./providers/azure-files";

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
```

### Step 5: Update File Server Actions Only

Update only `lib/actions/file.actions.ts` to use files database abstraction. **Leave `user.actions.ts` unchanged**.

```typescript
// lib/actions/file.actions.ts
"use server";

import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID, Models, Query } from "node-appwrite";
import { getFileType, parseStringify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/actions/user.actions";
import { getStorageProvider } from "@/lib/storage/factory";
import { getFilesDatabaseProvider } from "@/lib/database/factory"; // NEW

const handleError = (error: unknown, message: string) => {
  console.log(error, message);
  throw error;
};

export const uploadFile = async ({
  file,
  ownerId,
  accountId,
  path,
}: UploadFileProps) => {
  const storageProvider = getStorageProvider();
  const dbProvider = getFilesDatabaseProvider(); // NEW

  try {
    // Upload file to storage (Appwrite or Azure based on env var)
    const uploadResult = await storageProvider.uploadFile(file);

    const fileDocument = {
      type: getFileType(uploadResult.fileName).type,
      name: uploadResult.fileName,
      url: storageProvider.getFileUrl(uploadResult.fileId),
      extension: getFileType(uploadResult.fileName).extension,
      size: uploadResult.fileSize,
      owner: ownerId,
      accountId,
      users: [],
      bucketFileId: uploadResult.fileId,
    };

    // Save to database (Appwrite or Azure based on env var)
    const newFile = await dbProvider
      .createFile(fileDocument)
      .catch(async (error) => {
        await storageProvider.deleteFile(uploadResult.fileId);
        handleError(error, "Failed to create file document");
      });

    revalidatePath(path);
    return parseStringify(newFile);
  } catch (error) {
    handleError(error, "Failed to upload file");
  }
};

export const getFiles = async ({
  types = [],
  searchText = "",
  sort = "$createdAt-desc",
  limit,
}: GetFilesProps) => {
  const dbProvider = getFilesDatabaseProvider(); // NEW

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("User not found");

    const [sortBy, orderBy] = sort.split("-");

    const result = await dbProvider.listFiles({
      owner: currentUser.$id,
      sharedWith: currentUser.email,
      types,
      searchText,
      sort: { field: sortBy, direction: orderBy as "asc" | "desc" },
      limit,
    });

    return parseStringify(result.documents);
  } catch (error) {
    handleError(error, "Failed to get files");
  }
};

export const renameFile = async ({
  fileId,
  name,
  extension,
  path,
}: RenameFileProps) => {
  const dbProvider = getFilesDatabaseProvider(); // NEW

  try {
    const newName = `${name}.${extension}`;
    const updatedFile = await dbProvider.updateFile(fileId, { name: newName });

    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

export const updateFileUsers = async ({
  fileId,
  emails,
  path,
}: UpdateFileUsersProps) => {
  const dbProvider = getFilesDatabaseProvider(); // NEW

  try {
    const updatedFile = await dbProvider.updateFile(fileId, { users: emails });

    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to update file users");
  }
};

export const deleteFile = async ({
  fileId,
  bucketFileId,
  path,
}: DeleteFileProps) => {
  const storageProvider = getStorageProvider();
  const dbProvider = getFilesDatabaseProvider(); // NEW

  try {
    await dbProvider.deleteFile(fileId);
    await storageProvider.deleteFile(bucketFileId);

    revalidatePath(path);
    return parseStringify({ status: "success" });
  } catch (error) {
    handleError(error, "Failed to delete file");
  }
};

export async function getTotalSpaceUsed() {
  try {
    const dbProvider = getFilesDatabaseProvider(); // NEW
    const currentUser = await getCurrentUser();

    if (!currentUser) throw new Error("User is not authenticated.");

    const totalSpace = await dbProvider.getTotalSpaceByOwner(currentUser.$id);

    return parseStringify(totalSpace);
  } catch (error) {
    handleError(error, "Failed to get total space used.");
  }
}
```

## Environment Variables

Add to `.env.local`:

```bash
# Files Database Provider Selection
FILES_DATABASE_PROVIDER=appwrite  # Change to "azure" to switch

# Keep existing Appwrite vars (used for users table always)
NEXT_PUBLIC_APPWRITE_ENDPOINT=...
NEXT_PUBLIC_APPWRITE_DATABASE=...
NEXT_PUBLIC_APPWRITE_USERS_COLLECTION=...     # Still used
NEXT_PUBLIC_APPWRITE_FILES_COLLECTION=...     # Only used when FILES_DATABASE_PROVIDER=appwrite

# Azure Table Storage uses same connection string as Blob Storage
# AZURE_STORAGE_CONNECTION_STRING already configured
# AZURE_STORAGE_ACCOUNT_NAME can be extracted from connection string
```

## Dependencies

```bash
npm install @azure/data-tables
```

## Azure Setup

```bash
# Table is created automatically on first insert, or create explicitly:
az storage table create \
  --name files \
  --account-name ahsacontainerappdemostg \
  --connection-string $AZURE_STORAGE_CONNECTION_STRING

# Note: No users table needed - staying in Appwrite
```

## Key Differences: Appwrite vs Azure Table Storage

### Appwrite Database

- ✅ Rich query language with filters, sorting
- ✅ Built-in relationships and permissions
- ✅ Real-time subscriptions
- ❌ Vendor lock-in
- ❌ Scaling limitations

### Azure Table Storage

- ✅ Highly scalable (petabytes)
- ✅ Cost-effective (~$0.045/GB/month)
- ✅ Partition-based queries (very fast)
- ❌ Limited query capabilities
- ❌ No complex joins
- ❌ String-based filtering only

## Partitioning Strategy

### Files Table

```
PartitionKey: ownerId (partition by owner for fast owner-based queries)
RowKey: fileId (unique identifier)
```

**Why partition by owner?**

- Most queries filter by owner (user's files dashboard)
- Fast retrieval of all files for a user
- Efficient `getTotalSpaceUsed()` queries
- Enables efficient pagination

**No Users Table in Azure** - Users remain in Appwrite Database

## Query Translation

### Appwrite Query → Azure Table Storage

```typescript
// Appwrite
Query.equal("owner", [userId]);
Query.contains("name", searchText);
Query.orderDesc("$createdAt");
Query.limit(10);

// Azure Table Storage
filter: `PartitionKey eq '${userId}'`;
// Then filter/sort in-memory or use secondary indexes
```

## Challenges & Solutions

### Challenge 1: Complex Queries

**Problem**: Azure Table Storage doesn't support complex queries like Appwrite

**Solution**:

- Use partition keys wisely (partition by owner = most common query)
- Fetch data and filter/sort in-memory for complex cases
- Most queries are simple (get user's files by owner ID) = fast with partitioning

### Challenge 2: Array Fields (users array)

**Problem**: Azure Table Storage doesn't support array types

**Solution**:

- Store `users` array as JSON string: `users: JSON.stringify(file.users)`
- Parse on read: `users: JSON.parse(entity.users || "[]")`

### Challenge 3: Shared Files Query

**Problem**: Query "files shared with me" requires scanning all files to check `users` array

**Solution** (Chosen Approach):

**In-memory filtering for shared files** - This is acceptable because:

1. Shared files queries are less common than "my files" queries
2. Users typically don't have thousands of shared files
3. Can optimize later with a separate shared files index if needed

```typescript
// Fast: Get my files (uses partitionKey)
await dbProvider.listFiles({ owner: userId }); // Efficient

// Slower: Get shared files (scans and filters)
await dbProvider.listFiles({ sharedWith: userEmail }); // Acceptable
```

### Challenge 4: User Lookup by Email

**Not an issue** - Users table stays in Appwrite, so user lookups remain fast with Appwrite's query system.

### Challenge 5: Cross-Partition Transactions

**Problem**: Azure Table Storage has limited transaction support across partitions

**Solution**:

- Delete operations: Delete from database first, then storage (can retry storage deletion)
- Update operations: Single partition updates only (file metadata)

## Testing Strategy

### Phase 1: Dual-Read Testing

1. Set `DATABASE_PROVIDER=appwrite`
2. Implement dual-read: Query from both Appwrite and Azure
3. Compare results, log discrepancies
4. Don't expose Azure data yet

### Phase 2: Shadow Write

1. Write to both Appwrite and Azure
2. Read from Appwrite only
3. Verify data consistency

### Phase 3: Switch & Monitor

1. Set `DATABASE_PROVIDER=azure`
2. Read from Azure, write to both
3. Monitor for 1 week
4. Stop writing to Appwrite

## Rollback Plan

### Immediate Rollback

```bash
# In .env.local
DATABASE_PROVIDER=appwrite
```

Restart app → Back to Appwrite database

### Full Rollback with Data

If Azure data has been modified:

1. Export data from Azure Table Storage
2. Import back to Appwrite
3. Verify data integrity
4. Switch environment variable

## Migration Script (Existing Files Data Only)

If you have existing files in Appwrite to migrate:

```typescript
// scripts/migrate-files-to-azure.ts
import { createAdminClient } from "@/lib/appwrite";
import { appwriteConfig } from "@/lib/appwrite/config";
import { AzureFilesProvider } from "@/lib/database/providers/azure-files";
import { Query } from "node-appwrite";

async function migrateFilesData() {
  const { databases } = await createAdminClient();
  const azureDB = new AzureFilesProvider();

  console.log("Migrating files metadata to Azure Table Storage...");

  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const files = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      [Query.limit(limit), Query.offset(offset)]
    );

    for (const file of files.documents) {
      await azureDB.createFile({
        type: file.type,
        name: file.name,
        url: file.url,
        extension: file.extension,
        size: file.size,
        owner: file.owner,
        accountId: file.accountId,
        users: file.users,
        bucketFileId: file.bucketFileId,
      });
      console.log(`Migrated file: ${file.name}`);
    }

    offset += limit;
    hasMore = files.documents.length === limit;
    console.log(`Progress: ${offset} files migrated`);
  }

  console.log("Files migration complete!");
  console.log("Users remain in Appwrite - no migration needed.");
}

migrateFilesData().catch(console.error);
```

Run: `npx tsx scripts/migrate-files-to-azure.ts`

**Note**: This only migrates file metadata. Blobs are already in Azure if Phase 1 was completed with `STORAGE_PROVIDER=azure`.

## Success Criteria

✅ **Phase 2 Complete When**:

1. All file metadata operations work with `FILES_DATABASE_PROVIDER=azure`
2. Query performance acceptable (< 300ms for owner queries, < 1s for shared queries)
3. Can toggle between providers without code changes
4. User authentication still works (unchanged - still in Appwrite)
5. File sharing queries functional
6. Dashboard statistics accurate
7. Rollback tested successfully
8. Users table operations unchanged (still in Appwrite)

## Performance Considerations

### Appwrite

- Typical query: 50-200ms
- Complex filters: Fast (server-side)
- Scalability: Moderate

### Azure Table Storage

- Partition key query: 10-50ms (very fast)
- Cross-partition query: 100-500ms (slower)
- Scalability: Excellent

**Optimization Tips**:

1. Always use partition key in queries
2. Cache frequently accessed data
3. Use batch operations for multiple inserts
4. Consider Azure Redis Cache for hot data

## Cost Comparison

### Appwrite Database

- Free tier: Limited
- Pro: ~$15-50/month depending on scale

### Azure Table Storage

- Storage: ~$0.045/GB/month
- Transactions: ~$0.01 per 100,000 operations
- **Estimated for 10K users, 100K files**: ~$2-5/month

## Security Considerations

1. **Connection String**: Use Azure Key Vault in production
2. **Access Control**: Implement row-level security in application layer
3. **Encryption**: Azure Table Storage encrypted at rest by default
4. **Audit Logs**: Enable Azure Storage Analytics

## Timeline Estimate (Simplified)

- **Files Abstraction Layer**: 2-3 hours
- **Appwrite Files Provider**: 2-3 hours
- **Azure Files Provider**: 4-5 hours
- **Update file.actions.ts**: 2-3 hours
- **Testing**: 3-4 hours
- **Migration Script**: 1-2 hours

**Total Phase 2**: ~14-20 hours (reduced from 18-26 hours)

## After Phase 2

You'll have a hybrid Azure solution:

- ✅ Azure Blob Storage for file blobs
- ✅ Azure Table Storage for file metadata
- ✅ Appwrite Database for users (authentication, user management)
- ✅ Simplified architecture - focus on high-value migration
- ✅ Can decommission Appwrite's file storage entirely

**Architecture Benefits:**

- Files table is large and growing → Benefits from Azure's scalability
- Users table is small and stable → Fine to keep in Appwrite
- Authentication complexity avoided → Faster implementation
- Can migrate users to Azure later if needed

## Alternative: Azure Cosmos DB

If you need richer queries, consider Azure Cosmos DB with Table API:

- Compatible with Azure Table Storage code
- Supports complex queries, indexing
- Higher cost (~$25/month minimum)
- Better for complex applications

Would recommend staying with Table Storage unless you hit query limitations.

---

## Approval Checklist for Phase 2

Before proceeding:

- [ ] Phase 1 (Blob Storage) fully tested and working
- [ ] Understand Azure Table Storage limitations
- [ ] Approve partitioning strategy
- [ ] Review query performance requirements
- [ ] Approve migration timeline
- [ ] Budget approved for Azure Table Storage costs
- [ ] Rollback strategy understood
