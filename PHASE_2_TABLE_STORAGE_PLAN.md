# Phase 2: Azure Table Storage Migration Plan

## Overview

Migrate users and files metadata from Appwrite Database to Azure Table Storage while maintaining rollback capability.

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
│ Storage        │  │ - users table  │ ← To migrate
│ (Files/Blobs)  │  │ - files table  │ ← To migrate
└────────────────┘  └────────────────┘
```

## Target State (Phase 2)

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
│ Azure Blob     │  │ Azure Table    │
│ Storage        │  │ Storage        │
│ (Files/Blobs)  │  │ - users table  │
└────────────────┘  │ - files table  │
                    └────────────────┘
```

## Phase 2 Implementation Strategy

### Step 1: Create Database Abstraction Layer

Similar to storage abstraction, create a database provider interface.

```typescript
// lib/database/types.ts
export interface User {
  $id: string;
  fullName: string;
  email: string;
  avatar: string;
  accountId: string;
  $createdAt?: string;
  $updatedAt?: string;
}

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

export interface DatabaseProvider {
  // User operations
  createUser(user: Omit<User, "$id">): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByAccountId(accountId: string): Promise<User | null>;

  // File operations
  createFile(file: Omit<FileMetadata, "$id">): Promise<FileMetadata>;
  getFile(fileId: string): Promise<FileMetadata | null>;
  updateFile(
    fileId: string,
    updates: Partial<FileMetadata>
  ): Promise<FileMetadata>;
  deleteFile(fileId: string): Promise<void>;
  listFiles(
    filters: FileFilters
  ): Promise<{ documents: FileMetadata[]; total: number }>;

  // Query operations
  queryFiles(userId: string, options: QueryOptions): Promise<FileMetadata[]>;
}

export interface FileFilters {
  owner?: string;
  types?: FileType[];
  searchText?: string;
  sharedWith?: string;
}

export interface QueryOptions {
  sort?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
```

### Step 2: Implement Appwrite Database Provider

```typescript
// lib/database/providers/appwrite-database.ts
import { DatabaseProvider, User, FileMetadata } from "../types";
import { createAdminClient } from "@/lib/appwrite";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID, Query } from "node-appwrite";

export class AppwriteDatabaseProvider implements DatabaseProvider {
  async createUser(user: Omit<User, "$id">): Promise<User> {
    const { databases } = await createAdminClient();
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.usersCollectionId,
      ID.unique(),
      user
    );
    return this.mapToUser(doc);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { databases } = await createAdminClient();
    const result = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.usersCollectionId,
      [Query.equal("email", [email])]
    );
    return result.total > 0 ? this.mapToUser(result.documents[0]) : null;
  }

  // ... implement all other methods

  private mapToUser(doc: any): User {
    return {
      $id: doc.$id,
      fullName: doc.fullName,
      email: doc.email,
      avatar: doc.avatar,
      accountId: doc.accountId,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    };
  }
}
```

### Step 3: Implement Azure Table Storage Provider

```typescript
// lib/database/providers/azure-table.ts
import { DatabaseProvider, User, FileMetadata } from "../types";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

export class AzureTableDatabaseProvider implements DatabaseProvider {
  private usersTable: TableClient;
  private filesTable: TableClient;

  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = this.extractAccountKey();
    const credential = new AzureNamedKeyCredential(accountName, accountKey);

    this.usersTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      "users",
      credential
    );

    this.filesTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      "files",
      credential
    );
  }

  async createUser(user: Omit<User, "$id">): Promise<User> {
    const userId = crypto.randomUUID();
    const entity = {
      partitionKey: "user",
      rowKey: userId,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      accountId: user.accountId,
    };

    await this.usersTable.createEntity(entity);

    return {
      $id: userId,
      ...user,
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const queryIterator = this.usersTable.listEntities({
      queryOptions: {
        filter: `email eq '${email}'`,
      },
    });

    for await (const entity of queryIterator) {
      return this.mapToUser(entity);
    }

    return null;
  }

  async createFile(file: Omit<FileMetadata, "$id">): Promise<FileMetadata> {
    const fileId = crypto.randomUUID();
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
    };

    await this.filesTable.createEntity(entity);

    return {
      $id: fileId,
      ...file,
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };
  }

  async queryFiles(
    userId: string,
    options: QueryOptions
  ): Promise<FileMetadata[]> {
    // Azure Table Storage queries by partitionKey (owner)
    const filter = `PartitionKey eq '${userId}'`;

    const queryIterator = this.filesTable.listEntities({
      queryOptions: { filter },
    });

    const files: FileMetadata[] = [];
    for await (const entity of queryIterator) {
      files.push(this.mapToFile(entity));
    }

    // Apply sorting and filtering in-memory (or use advanced queries)
    return this.applyOptions(files, options);
  }

  private mapToUser(entity: any): User {
    return {
      $id: entity.rowKey,
      fullName: entity.fullName,
      email: entity.email,
      avatar: entity.avatar,
      accountId: entity.accountId,
      $createdAt: entity.timestamp?.toISOString(),
      $updatedAt: entity.timestamp?.toISOString(),
    };
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
      $createdAt: entity.timestamp?.toISOString(),
      $updatedAt: entity.timestamp?.toISOString(),
    };
  }

  private extractAccountKey(): string {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
    const match = connectionString.match(/AccountKey=([^;]+)/);
    if (!match) throw new Error("Could not extract AccountKey");
    return match[1];
  }

  private applyOptions(
    files: FileMetadata[],
    options: QueryOptions
  ): FileMetadata[] {
    let result = [...files];

    // Apply sorting
    if (options.sort) {
      result.sort((a, b) => {
        const aVal = (a as any)[options.sort!.field];
        const bVal = (b as any)[options.sort!.field];
        return options.sort!.direction === "asc"
          ? aVal > bVal
            ? 1
            : -1
          : aVal < bVal
            ? 1
            : -1;
      });
    }

    // Apply limit
    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }
}
```

### Step 4: Create Database Factory

```typescript
// lib/database/factory.ts
import { DatabaseProvider } from "./types";
import { AppwriteDatabaseProvider } from "./providers/appwrite-database";
import { AzureTableDatabaseProvider } from "./providers/azure-table";

export function getDatabaseProvider(): DatabaseProvider {
  const provider = process.env.DATABASE_PROVIDER || "appwrite";

  switch (provider) {
    case "azure":
      return new AzureTableDatabaseProvider();
    case "appwrite":
    default:
      return new AppwriteDatabaseProvider();
  }
}
```

### Step 5: Update Server Actions

Update `lib/actions/user.actions.ts` and `lib/actions/file.actions.ts` to use database abstraction:

```typescript
// lib/actions/user.actions.ts
import { getDatabaseProvider } from "@/lib/database/factory";

export const createAccount = async ({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) => {
  const dbProvider = getDatabaseProvider();

  const existingUser = await dbProvider.getUserByEmail(email);
  const accountId = await sendEmailOTP({ email });

  if (!accountId) throw new Error("Failed to send an OTP");

  if (!existingUser) {
    await dbProvider.createUser({
      fullName,
      email,
      avatar: avatarPlaceholderUrl,
      accountId,
    });
  }

  return parseStringify({ accountId });
};
```

## Environment Variables

Add to `.env.local`:

```bash
# Database Provider Selection
DATABASE_PROVIDER=appwrite  # Change to "azure" to switch

# Keep existing Appwrite vars for rollback
NEXT_PUBLIC_APPWRITE_ENDPOINT=...
NEXT_PUBLIC_APPWRITE_DATABASE=...
NEXT_PUBLIC_APPWRITE_USERS_COLLECTION=...
NEXT_PUBLIC_APPWRITE_FILES_COLLECTION=...

# Azure Table Storage uses same connection string as Blob Storage
# AZURE_STORAGE_CONNECTION_STRING already configured
```

## Dependencies

```bash
npm install @azure/data-tables
```

## Azure Setup

```bash
# Tables are created automatically on first insert, or create explicitly:
az storage table create \
  --name users \
  --account-name ahsacontainerappdemostg \
  --connection-string $AZURE_STORAGE_CONNECTION_STRING

az storage table create \
  --name files \
  --account-name ahsacontainerappdemostg \
  --connection-string $AZURE_STORAGE_CONNECTION_STRING
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

### Users Table

```
PartitionKey: "user" (all users in same partition, small dataset)
RowKey: userId (unique identifier)
```

### Files Table

```
PartitionKey: ownerId (partition by owner for fast owner-based queries)
RowKey: fileId (unique identifier)
```

**Why partition by owner?**

- Most queries filter by owner
- Fast retrieval of all files for a user
- Enables efficient pagination

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

- Use partition keys wisely for most common queries
- Fetch data and filter/sort in-memory for complex cases
- Consider Azure Cosmos DB Table API for richer queries (higher cost)

### Challenge 2: Array Fields

**Problem**: Azure Table Storage doesn't support array types

**Solution**:

- Store arrays as JSON strings
- Parse on read: `users: JSON.parse(entity.users || "[]")`
- Stringify on write: `users: JSON.stringify(file.users)`

### Challenge 3: Shared Files Query

**Problem**: Query "files shared with me" requires scanning `users` array

**Solution** (Two approaches):

**Option A**: Dual writes

```typescript
// Main files table (partitioned by owner)
await filesTable.createEntity({ partitionKey: ownerId, ... });

// Shared files index (partitioned by shared user)
for (const sharedEmail of file.users) {
  await sharedFilesTable.createEntity({
    partitionKey: sharedEmail,
    rowKey: fileId,
    // Store minimal data or just reference
  });
}
```

**Option B**: In-memory filtering

```typescript
// Fetch all files (or subset) and filter
const allFiles = await getAllFiles();
const sharedFiles = allFiles.filter((f) => f.users.includes(userEmail));
```

### Challenge 4: Transaction Rollback

**Problem**: Azure Table Storage has limited transaction support

**Solution**:

- Keep database writes as last operation
- Implement compensating transactions for failures
- Use batch operations where possible

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

## Migration Script (Existing Data)

If you have existing Appwrite data to migrate:

```typescript
// scripts/migrate-to-azure.ts
import { createAdminClient } from "@/lib/appwrite";
import { AzureTableDatabaseProvider } from "@/lib/database/providers/azure-table";

async function migrateData() {
  const { databases } = await createAdminClient();
  const azureDB = new AzureTableDatabaseProvider();

  // Migrate users
  console.log("Migrating users...");
  const users = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.usersCollectionId
  );

  for (const user of users.documents) {
    await azureDB.createUser({
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      accountId: user.accountId,
    });
    console.log(`Migrated user: ${user.email}`);
  }

  // Migrate files
  console.log("Migrating files...");
  const files = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.filesCollectionId
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

  console.log("Migration complete!");
}

migrateData().catch(console.error);
```

Run: `npx tsx scripts/migrate-to-azure.ts`

## Success Criteria

✅ **Phase 2 Complete When**:

1. All user operations work with `DATABASE_PROVIDER=azure`
2. All file metadata operations work
3. Query performance acceptable (< 500ms for typical queries)
4. Can toggle between providers without code changes
5. Authentication still works (OTP flow unchanged)
6. File sharing queries functional
7. Dashboard statistics accurate
8. Rollback tested successfully

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

## Timeline Estimate

- **Abstraction Layer**: 3-4 hours
- **Appwrite Provider**: 2-3 hours
- **Azure Provider**: 4-6 hours
- **Update Server Actions**: 3-4 hours
- **Testing**: 4-6 hours
- **Migration Script**: 2-3 hours

**Total Phase 2**: ~18-26 hours

## After Phase 2

You'll have fully migrated to Azure:

- ✅ Azure Blob Storage for files
- ✅ Azure Table Storage for metadata
- ✅ Complete Azure-native solution
- ✅ Ability to decommission Appwrite entirely

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
