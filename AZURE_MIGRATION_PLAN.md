# Azure Storage Migration Plan

## Overview

Migrate from Appwrite Storage to Azure Blob Storage while maintaining rollback capability and keeping Appwrite for user/file metadata tables initially.

## Phase 1: Azure Blob Storage Integration (Current Focus)

### Goal

Replace Appwrite Storage with Azure Blob Storage for file blob storage while keeping all metadata in Appwrite database.

### Current Storage Points (Appwrite)

#### 1. **Upload File** (`lib/actions/file.actions.ts:uploadFile`)

- **Current**: `storage.createFile()` → Appwrite bucket
- **Returns**: `bucketFileId`, `name`, `sizeOriginal`
- **Used by**: FileUploader component

#### 2. **Delete File** (`lib/actions/file.actions.ts:deleteFile`)

- **Current**: `storage.deleteFile(bucketId, bucketFileId)`
- **Triggered after**: Database document deletion

#### 3. **File URL Construction** (`lib/utils.ts`)

- **View URL**: `constructFileUrl(bucketFileId)` → Appwrite view endpoint
- **Download URL**: `constructDownloadUrl(bucketFileId)` → Appwrite download endpoint
- **Used by**: Dashboard, ActionDropdown, file cards

### Implementation Strategy

#### Step 1: Create Storage Abstraction Layer

**Why**: Allows switching between Appwrite and Azure without changing business logic

```typescript
// lib/storage/types.ts
export interface StorageProvider {
  uploadFile(file: File): Promise<UploadResult>;
  deleteFile(fileId: string): Promise<void>;
  getFileUrl(fileId: string): string;
  getDownloadUrl(fileId: string): string;
}

export interface UploadResult {
  fileId: string; // Unique identifier (Azure blob name or Appwrite bucketFileId)
  fileName: string;
  fileSize: number;
}
```

#### Step 2: Implement Appwrite Storage Adapter

**Why**: Wrap existing Appwrite code into the abstraction interface

```typescript
// lib/storage/providers/appwrite-storage.ts
export class AppwriteStorageProvider implements StorageProvider {
  async uploadFile(file: File): Promise<UploadResult> {
    // Existing logic from uploadFile()
  }

  async deleteFile(fileId: string): Promise<void> {
    // Existing logic from deleteFile()
  }

  getFileUrl(fileId: string): string {
    // Existing constructFileUrl()
  }

  getDownloadUrl(fileId: string): string {
    // Existing constructDownloadUrl()
  }
}
```

#### Step 3: Implement Azure Blob Storage Adapter

**Why**: New provider following same interface

```typescript
// lib/storage/providers/azure-storage.ts
import { BlobServiceClient } from "@azure/storage-blob";

export class AzureBlobStorageProvider implements StorageProvider {
  private containerClient;

  constructor() {
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING!
    );
    this.containerClient = blobServiceClient.getContainerClient(
      process.env.AZURE_STORAGE_CONTAINER_NAME!
    );
  }

  async uploadFile(file: File): Promise<UploadResult> {
    const blobName = `${Date.now()}-${crypto.randomUUID()}-${file.name}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: file.type,
        blobContentDisposition: `inline; filename="${file.name}"`,
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
    // Generate SAS URL with view permissions or use public access
    const blockBlobClient = this.containerClient.getBlockBlobClient(fileId);
    return blockBlobClient.url;
  }

  getDownloadUrl(fileId: string): string {
    // Generate SAS URL with download permissions
    const blockBlobClient = this.containerClient.getBlockBlobClient(fileId);
    // Add SAS token generation here
    return `${blockBlobClient.url}?download=true`;
  }
}
```

#### Step 4: Create Storage Factory with Feature Flag

**Why**: Toggle between providers without code changes

```typescript
// lib/storage/factory.ts
import { StorageProvider } from "./types";
import { AppwriteStorageProvider } from "./providers/appwrite-storage";
import { AzureBlobStorageProvider } from "./providers/azure-storage";

export function getStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || "appwrite";

  switch (provider) {
    case "azure":
      return new AzureBlobStorageProvider();
    case "appwrite":
    default:
      return new AppwriteStorageProvider();
  }
}
```

#### Step 5: Update Server Actions

**Why**: Replace direct Appwrite calls with abstraction layer

```typescript
// lib/actions/file.actions.ts
import { getStorageProvider } from "@/lib/storage/factory";

export const uploadFile = async ({
  file,
  ownerId,
  accountId,
  path,
}: UploadFileProps) => {
  const { databases } = await createAdminClient();
  const storageProvider = getStorageProvider();

  try {
    // Upload to storage (Appwrite OR Azure)
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
      bucketFileId: uploadResult.fileId, // Now stores Azure blob name OR Appwrite bucketFileId
    };

    const newFile = await databases
      .createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.filesCollectionId,
        ID.unique(),
        fileDocument
      )
      .catch(async (error: unknown) => {
        // Rollback: delete from storage if DB insert fails
        await storageProvider.deleteFile(uploadResult.fileId);
        handleError(error, "Failed to create file document");
      });

    revalidatePath(path);
    return parseStringify(newFile);
  } catch (error) {
    handleError(error, "Failed to upload file");
  }
};

export const deleteFile = async ({
  fileId,
  bucketFileId,
  path,
}: DeleteFileProps) => {
  const { databases } = await createAdminClient();
  const storageProvider = getStorageProvider();

  try {
    const deletedFile = await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId
    );

    if (deletedFile) {
      await storageProvider.deleteFile(bucketFileId);
    }

    revalidatePath(path);
    return parseStringify({ status: "success" });
  } catch (error) {
    handleError(error, "Failed to delete file");
  }
};
```

#### Step 6: Update URL Utilities

**Why**: URLs now come from storage provider dynamically

```typescript
// lib/utils.ts
import { getStorageProvider } from "@/lib/storage/factory";

export const constructFileUrl = (bucketFileId: string) => {
  const storageProvider = getStorageProvider();
  return storageProvider.getFileUrl(bucketFileId);
};

export const constructDownloadUrl = (bucketFileId: string) => {
  const storageProvider = getStorageProvider();
  return storageProvider.getDownloadUrl(bucketFileId);
};
```

### Environment Variables

#### Add to `.env.local`:

```bash
# Storage Provider Selection
STORAGE_PROVIDER=appwrite  # Change to "azure" to switch

# Azure Storage (only needed when STORAGE_PROVIDER=azure)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER_NAME=user-files
AZURE_STORAGE_ACCOUNT_NAME=yourstorageaccount

# Keep existing Appwrite variables for database and fallback
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT=...
NEXT_PUBLIC_APPWRITE_DATABASE=...
NEXT_PUBLIC_APPWRITE_USERS_COLLECTION=...
NEXT_PUBLIC_APPWRITE_FILES_COLLECTION=...
NEXT_PUBLIC_APPWRITE_BUCKET=...
NEXT_APPWRITE_KEY=...
```

### Azure Setup Requirements

#### 1. Create Azure Storage Account

```bash
# Using Azure CLI
az storage account create \
  --name yourstorageaccount \
  --resource-group your-rg \
  --location eastus \
  --sku Standard_LRS

# Create container for user files
az storage container create \
  --name user-files \
  --account-name yourstorageaccount \
  --public-access off
```

#### 2. Configure CORS (for direct browser uploads if needed)

```bash
az storage cors add \
  --services b \
  --methods GET POST PUT DELETE \
  --origins "http://localhost:3000" "https://yourdomain.com" \
  --allowed-headers "*" \
  --account-name yourstorageaccount
```

#### 3. Generate SAS Token for Secure URLs

```typescript
// lib/storage/providers/azure-storage.ts
import { generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";

private generateSasUrl(blobName: string, permissions: string): string {
  const sasOptions = {
    containerName: this.containerClient.containerName,
    blobName: blobName,
    permissions: BlobSASPermissions.parse(permissions), // "r" for read, "rw" for download
    startsOn: new Date(),
    expiresOn: new Date(new Date().valueOf() + 3600 * 1000), // 1 hour
  };

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    this.sharedKeyCredential
  ).toString();

  return `${this.containerClient.url}/${blobName}?${sasToken}`;
}
```

### Dependencies to Install

```bash
npm install @azure/storage-blob
npm install @azure/identity  # For managed identity in production
```

### Testing Strategy

#### Phase 1: Development Testing

1. Set `STORAGE_PROVIDER=appwrite` - verify existing functionality works
2. Set `STORAGE_PROVIDER=azure` - test upload/download/delete with Azure
3. Toggle between providers - ensure no breakage

#### Phase 2: Parallel Running (Optional)

Upload to BOTH providers simultaneously, read from Azure:

```typescript
// Dual-write pattern for safety
if (process.env.ENABLE_DUAL_WRITE === "true") {
  await Promise.all([
    appwriteProvider.uploadFile(file),
    azureProvider.uploadFile(file),
  ]);
}
```

#### Phase 3: Migration Testing

1. Create test environment with Azure
2. Upload new files via Azure
3. Verify existing Appwrite files still accessible
4. Run migration script for old files (separate task)

### Rollback Plan

#### Immediate Rollback (No Data Migration)

1. Set `STORAGE_PROVIDER=appwrite` in `.env.local`
2. Restart application
3. All new operations use Appwrite
4. **Note**: Files uploaded to Azure remain there (no data loss)

#### Full Rollback with Data Migration

1. Run migration script to copy Azure blobs back to Appwrite
2. Update database `bucketFileId` fields with Appwrite IDs
3. Switch environment variable
4. Delete Azure resources

### File Structure After Implementation

```
lib/
  storage/
    types.ts                      # StorageProvider interface
    factory.ts                    # Provider selection logic
    providers/
      appwrite-storage.ts         # Appwrite implementation
      azure-storage.ts            # Azure Blob implementation
  actions/
    file.actions.ts               # Updated to use abstraction
  utils.ts                        # Updated URL helpers
```

### Success Criteria

✅ **Phase 1 Complete When**:

1. All file operations work with `STORAGE_PROVIDER=azure`
2. Can toggle between providers without code changes
3. No business logic changes in components
4. All existing tests pass with both providers
5. URLs generated correctly for view/download
6. File deletion removes blobs from correct storage

### Known Challenges & Solutions

#### Challenge 1: SAS Token Expiration

**Problem**: Azure SAS URLs expire, Appwrite URLs don't
**Solution**:

- Use short-lived SAS tokens (1-hour)
- Regenerate URLs dynamically on page load
- Consider Azure CDN for public files

#### Challenge 2: File Naming

**Problem**: Azure requires unique blob names, Appwrite generates IDs
**Solution**:

- Use pattern: `{timestamp}-{uuid}-{originalFilename}`
- Store as `bucketFileId` in database

#### Challenge 3: Content-Type Handling

**Problem**: Azure needs explicit content-type, Appwrite infers it
**Solution**:

- Extract MIME type from File object during upload
- Set `blobHTTPHeaders.blobContentType`

#### Challenge 4: Migration of Existing Files

**Problem**: Existing files live in Appwrite
**Solution**:

- Phase 1: Don't migrate, dual-storage approach
- Phase 2: Background migration script (separate plan)
- Read from storage indicated by provider at upload time

### Next Steps After Phase 1

1. **Phase 2**: Migrate user/file tables to Azure Table Storage
2. **Phase 3**: Background migration of existing Appwrite blobs to Azure
3. **Phase 4**: Decomission Appwrite entirely

### Security Considerations

1. **Connection Strings**: Store in Azure Key Vault in production
2. **SAS Permissions**: Minimum required (read-only for view, download for saves)
3. **Container Access**: Private by default, use SAS tokens
4. **CORS**: Restrict to production domains only
5. **Managed Identity**: Use in Azure App Service instead of connection strings

### Performance Considerations

1. **Upload Speed**: Azure Blob typically faster for large files
2. **CDN Integration**: Consider Azure CDN for frequently accessed files
3. **Region Selection**: Deploy storage in same region as compute
4. **Caching**: Implement caching layer for SAS URL generation

### Monitoring & Observability

1. **Azure Monitor**: Track blob operations (upload/delete/access)
2. **Application Insights**: Log storage provider selection and errors
3. **Cost Tracking**: Monitor Azure storage costs vs Appwrite
4. **Error Alerts**: Set up alerts for storage operation failures

---

## Approval Checklist

Before proceeding with implementation:

- [ ] Confirm Azure subscription and resource group setup
- [ ] Review security model (SAS tokens vs managed identity)
- [ ] Approve dual-write strategy for testing
- [ ] Confirm rollback acceptance criteria
- [ ] Review cost implications of Azure Blob Storage
- [ ] Approve phased migration approach

---

## Estimated Timeline

- **Setup & Abstraction Layer**: 2-3 hours
- **Azure Provider Implementation**: 3-4 hours
- **Integration & Testing**: 2-3 hours
- **Documentation & Rollback Testing**: 1-2 hours

**Total Phase 1**: ~8-12 hours of development work
