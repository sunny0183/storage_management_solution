# Azure Storage Migration - Quick Reference

## 📋 Phase 1 Overview: Blob Storage Migration

### Current State (Appwrite)

```
┌─────────────────────────────────────────────┐
│           Next.js Application               │
├─────────────────────────────────────────────┤
│  Server Actions (lib/actions)               │
│  ├─ uploadFile()                            │
│  ├─ deleteFile()                            │
│  └─ getFiles()                              │
└──────────────┬──────────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │   Appwrite Cloud     │
    ├──────────────────────┤
    │  Storage Bucket      │ ← Files (blobs)
    │  Database            │
    │  ├─ users collection │ ← Metadata
    │  └─ files collection │ ← Metadata
    └──────────────────────┘
```

### Target State (Phase 1)

```
┌─────────────────────────────────────────────┐
│           Next.js Application               │
├─────────────────────────────────────────────┤
│  Server Actions (lib/actions)               │
│  ├─ uploadFile()                            │
│  ├─ deleteFile()                            │
│  └─ getFiles()                              │
└──────────────┬──────────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Storage Abstraction  │ ← NEW LAYER
    │  (lib/storage)       │
    └──────────┬───────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌────────────┐  ┌────────────────┐
│ Appwrite   │  │ Azure Blob     │
│ Provider   │  │ Provider       │
└────────────┘  └────────────────┘
       │               │
       ▼               ▼
┌────────────┐  ┌────────────────┐
│ Appwrite   │  │ Azure Storage  │
│ Storage    │  │ Account        │
└────────────┘  └────────────────┘

┌─────────────────────────┐
│   Appwrite Database     │ ← Still used for metadata
│   ├─ users collection   │
│   └─ files collection   │
└─────────────────────────┘
```

## 🎯 Implementation Steps

### 1️⃣ Create Abstraction Layer (1-2 hours)

📁 Create: `lib/storage/types.ts`

```typescript
export interface StorageProvider {
  uploadFile(file: File): Promise<UploadResult>;
  deleteFile(fileId: string): Promise<void>;
  getFileUrl(fileId: string): string;
  getDownloadUrl(fileId: string): string;
}
```

### 2️⃣ Wrap Existing Code (1 hour)

📁 Create: `lib/storage/providers/appwrite-storage.ts`

- Move existing Appwrite storage logic into class
- Implement `StorageProvider` interface
- No functional changes, just reorganization

### 3️⃣ Implement Azure Provider (2-3 hours)

📁 Create: `lib/storage/providers/azure-storage.ts`

```bash
npm install @azure/storage-blob
```

- Implement `StorageProvider` interface
- Handle blob upload/delete
- Generate SAS URLs for view/download

### 4️⃣ Create Feature Flag (30 mins)

📁 Create: `lib/storage/factory.ts`

```typescript
export function getStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || "appwrite";
  return provider === "azure"
    ? new AzureBlobStorageProvider()
    : new AppwriteStorageProvider();
}
```

### 5️⃣ Update Server Actions (1 hour)

📁 Modify: `lib/actions/file.actions.ts`

- Replace direct Appwrite calls
- Use `getStorageProvider()`
- No changes to function signatures

### 6️⃣ Update Utilities (30 mins)

📁 Modify: `lib/utils.ts`

- Update `constructFileUrl()`
- Update `constructDownloadUrl()`
- Use storage provider dynamically

## 🔄 Rollback Strategy

### Instant Rollback (No Code Changes)

```bash
# In .env.local
STORAGE_PROVIDER=appwrite  # Change from "azure" to "appwrite"
```

↻ Restart app → Back to Appwrite storage

### What Happens to Data?

- ✅ Files uploaded to Azure remain in Azure (no data loss)
- ✅ Files uploaded to Appwrite remain in Appwrite
- ✅ Database metadata points to correct storage via `bucketFileId`
- ⚠️ To fully rollback: Migrate Azure files back to Appwrite (separate script)

## 🧪 Testing Checklist

### With `STORAGE_PROVIDER=appwrite`

- [ ] Upload file → Verify in Appwrite dashboard
- [ ] View file → URL works
- [ ] Download file → File downloads correctly
- [ ] Delete file → Removed from Appwrite storage
- [ ] Share file → URL accessible

### With `STORAGE_PROVIDER=azure`

- [ ] Upload file → Verify in Azure Portal
- [ ] View file → SAS URL works
- [ ] Download file → File downloads correctly
- [ ] Delete file → Removed from Azure Blob Storage
- [ ] Share file → SAS URL accessible

### Toggle Test

- [ ] Upload 3 files with `STORAGE_PROVIDER=appwrite`
- [ ] Switch to `STORAGE_PROVIDER=azure`
- [ ] Upload 3 files with Azure
- [ ] Verify all 6 files visible and accessible
- [ ] Switch back to `STORAGE_PROVIDER=appwrite`
- [ ] Upload 2 more files
- [ ] Verify all 8 files still work

## 📦 Files to Create/Modify

### New Files (Create)

```
lib/
  storage/
    ├── types.ts                    # Interface definitions
    ├── factory.ts                  # Provider selection
    └── providers/
        ├── appwrite-storage.ts     # Appwrite wrapper
        └── azure-storage.ts        # Azure implementation
```

### Modified Files

```
lib/
  ├── actions/
  │   └── file.actions.ts          # Use abstraction layer
  └── utils.ts                      # Dynamic URL generation
```

### No Changes Needed

```
components/                         # No changes
app/                               # No changes
types/index.d.ts                   # No changes (bucketFileId reused)
```

## 🚨 Critical Points

### DO ✅

- ✅ Implement abstraction layer BEFORE touching Azure code
- ✅ Test with Appwrite provider first (should work identically)
- ✅ Use environment variable for provider selection
- ✅ Keep `bucketFileId` field name (works for both providers)
- ✅ Generate SAS tokens with expiration for Azure URLs
- ✅ Set proper CORS on Azure Storage for browser access
- ✅ Test rollback before going to production

### DON'T ❌

- ❌ Directly modify `file.actions.ts` to add Azure calls
- ❌ Remove Appwrite code until migration is complete
- ❌ Change database schema or field names
- ❌ Expose Azure connection strings in client-side code
- ❌ Use public blob access (use SAS tokens instead)
- ❌ Skip testing rollback scenario

## 💰 Cost Comparison

### Appwrite (Current)

- Free tier: 2GB storage
- Beyond: Paid plans

### Azure Blob Storage (Target)

- ~$0.018/GB/month (Hot tier)
- ~$0.01/GB/month (Cool tier)
- Transactions: ~$0.004 per 10,000 operations
- **Estimated for 100GB**: ~$1.80-$2/month

## 🔐 Security Checklist

### Azure Storage

- [ ] Connection string stored in environment variables (not in code)
- [ ] Container set to private access (not public)
- [ ] SAS tokens with expiration (max 1 hour recommended)
- [ ] SAS tokens with minimum permissions (read-only for view)
- [ ] CORS configured for specific domains only
- [ ] Managed Identity enabled in production (not connection strings)

### Appwrite (Unchanged)

- [ ] API key server-side only
- [ ] Session cookies httpOnly
- [ ] Bucket permissions restricted

## 📊 Success Metrics

- [ ] Zero downtime during migration
- [ ] All file operations working with both providers
- [ ] Rollback tested and documented
- [ ] Upload/download speeds equal or faster
- [ ] No broken file URLs
- [ ] All existing files remain accessible

## 🎓 Azure Resources

### Setup Commands

```bash
# Login to Azure
az login

# Create storage account
az storage account create \
  --name mystorageaccount \
  --resource-group my-rg \
  --location eastus \
  --sku Standard_LRS

# Create container
az storage container create \
  --name user-files \
  --account-name mystorageaccount \
  --public-access off

# Get connection string
az storage account show-connection-string \
  --name mystorageaccount \
  --resource-group my-rg
```

### Useful Azure Portal Links

- Storage Accounts: https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Storage%2FStorageAccounts
- Monitor Blob Operations: Storage Account → Monitoring → Metrics
- Check Costs: Cost Management → Cost Analysis

## 📞 Support

- **Migration Plan**: See `AZURE_MIGRATION_PLAN.md` for detailed technical guide
- **Appwrite Docs**: https://appwrite.io/docs/storage
- **Azure Blob Docs**: https://learn.microsoft.com/azure/storage/blobs/
- **Azure SDK Docs**: https://learn.microsoft.com/javascript/api/@azure/storage-blob/

---

## Quick Decision Tree

```
Need to work on storage code?
  │
  ├─ Adding new feature?
  │   └─→ Use StorageProvider interface (works with both)
  │
  ├─ Bug in file operations?
  │   ├─→ STORAGE_PROVIDER=appwrite? Fix in appwrite-storage.ts
  │   └─→ STORAGE_PROVIDER=azure? Fix in azure-storage.ts
  │
  ├─ Migration not working?
  │   └─→ Check AZURE_MIGRATION_PLAN.md
  │
  └─ Need to rollback?
      └─→ Change .env.local STORAGE_PROVIDER=appwrite
```
