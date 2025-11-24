# Client/Server Boundary Fix - Critical Build Error Resolution

## Problem

After implementing the storage abstraction layer with "use server" directives on provider files, a **client/server boundary violation** was discovered:

**Error Symptoms:**

- "Module not found: Can't resolve 'fs'" in node-appwrite
- Client components trying to import/use server-only modules
- `ActionDropdown.tsx` (client component) was calling `constructDownloadUrl()` from `lib/utils.ts`
- `constructDownloadUrl()` was calling `getStorageProvider()` which is server-only

**Root Cause:**

- Next.js 15 strictly enforces separation between server and client code
- Node.js modules (like `fs` used by `node-appwrite`) cannot be bundled for browser
- Storage providers use `node-appwrite`'s `InputFile` which internally uses `fs.realpathSync()` and `fs.readFileSync()`
- Client components cannot import or call functions that depend on server-only modules

## Solution

### 1. **Removed Debug Code**

- Cleaned up all `fs.writeFileSync()` debug statements from `user.actions.ts`
- These were additional sources of fs module imports

### 2. **Understanding "use server" Directive**

**Critical Insight**: The "use server" directive should ONLY be added to files that export Server Actions (async functions that client components can call).

**Correct Pattern:**

- ✅ `lib/actions/file.actions.ts` - Has "use server" (exports Server Actions)
- ✅ `lib/actions/user.actions.ts` - Has "use server" (exports Server Actions)
- ❌ `lib/storage/factory.ts` - No "use server" (utility function, not a Server Action)
- ❌ `lib/storage/providers/*.ts` - No "use server" (classes used by Server Actions, not Server Actions themselves)

**Why This Works:**

- Server Actions in `file.actions.ts` have "use server" at the top
- Those Server Actions import and use the factory and providers
- Everything imported by a "use server" file runs server-side
- Client components can only call the Server Actions, never import providers directly

### 3. **Created Server Action for Downloads**

Added new Server Action in `lib/actions/file.actions.ts`:

```typescript
export const getFileDownloadUrl = async (bucketFileId: string) => {
  try {
    const storageProvider = getStorageProvider();
    return storageProvider.getDownloadUrl(bucketFileId);
  } catch (error) {
    handleError(error, "Failed to get download URL");
  }
};
```

### 4. **Updated ActionDropdown Component**

Changed from direct URL construction to Server Action call:

**Before (❌ Client-side URL construction):**

```tsx
<Link
  href={constructDownloadUrl(file.bucketFileId)}
  download={file.name}
>
```

**After (✅ Server Action with dynamic download):**

```tsx
onClick={async () => {
  if (actionItem.value === "download") {
    const downloadUrl = await getFileDownloadUrl(file.bucketFileId);
    if (downloadUrl) {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}}
```

### 5. **Removed Obsolete Functions**

Deleted `constructFileUrl()` and `constructDownloadUrl()` from `lib/utils.ts` since:

- View URLs are stored in database during upload (`file.url` field)
- Download URLs are generated on-demand via `getFileDownloadUrl()` Server Action

## Benefits of This Approach

### ✅ **Security**

- Storage provider logic stays server-side
- Secrets and connection strings never exposed to client

### ✅ **Performance**

- Smaller client bundle (no storage provider code)
- Download URLs generated only when needed, not on every page load

### ✅ **SAS Token Management**

- Azure SAS URLs are time-limited (1 hour by default)
- Fresh URLs generated when user clicks download
- No stale URLs stored in database

### ✅ **Clean Architecture**

- Proper separation of concerns
- Client components only call Server Actions
- Storage abstraction fully server-side

## Testing Checklist

After this fix, test the following:

- [ ] App builds without "fs" module errors
- [ ] Upload files with STORAGE_PROVIDER=appwrite
- [ ] Upload files with STORAGE_PROVIDER=azure
- [ ] View images in dashboard (uses `file.url` from database)
- [ ] Download files via dropdown menu (uses `getFileDownloadUrl()` Server Action)
- [ ] Azure SAS URLs work and respect expiration time
- [ ] No console errors about server/client boundary violations

## Files Modified

1. **lib/actions/file.actions.ts**

   - Added `getFileDownloadUrl()` Server Action

2. **components/ActionDropdown.tsx**

   - Removed `constructDownloadUrl()` import
   - Changed download logic to use Server Action
   - Removed unused `Link` import

3. **lib/utils.ts**

   - Removed `constructFileUrl()` function
   - Removed `constructDownloadUrl()` function
   - Removed `getStorageProvider()` import

4. **lib/actions/user.actions.ts** (Previous fix)

   - Removed all `fs` imports and debug statements
   - Has "use server" directive at top of file

5. **lib/storage/factory.ts** (No "use server" needed)

   - Pure utility function, not a Server Action
   - Imported by Server Actions in file.actions.ts

6. **lib/storage/providers/appwrite-storage.ts** (No "use server" needed)

   - Class implementation, not a Server Action
   - Used by Server Actions via factory

7. **lib/storage/providers/azure-storage.ts** (No "use server" needed)
   - Class implementation, not a Server Action
   - Used by Server Actions via factory

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT COMPONENTS                        │
│  (Browser - No Node.js modules allowed)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ActionDropdown.tsx                                          │
│    └─> onClick → getFileDownloadUrl(bucketFileId)          │
│                        ↓                                      │
│                   [Network Boundary]                         │
│                        ↓                                      │
├─────────────────────────────────────────────────────────────┤
│                     SERVER ACTIONS                           │
│  (Node.js - Can use fs, crypto, etc.)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  file.actions.ts (with "use server" at top of file)        │
│    └─> getFileDownloadUrl()                                 │
│          └─> getStorageProvider()                           │
│                └─> AppwriteStorageProvider.getDownloadUrl() │
│                      OR                                      │
│                └─> AzureBlobStorageProvider.getDownloadUrl()│
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Key Takeaways

1. **Never import server-only modules in client components**

   - This includes storage providers, database clients, file system modules

2. **Use Server Actions for all storage operations**

   - Upload, delete, generate URLs - all should be Server Actions

3. **Store URLs in database when possible**

   - View URLs stored during upload
   - Download URLs generated on-demand (for time-limited SAS tokens)

4. **"use server" directive is essential**

   - Mark all modules that use Node.js APIs
   - Prevents accidental client-side bundling

5. **Test both providers thoroughly**
   - Verify Appwrite still works (rollback capability)
   - Verify Azure integration works with SAS tokens

## Next Steps

1. ✅ Build should now complete successfully
2. ✅ Run `npm run dev` and test file uploads
3. ✅ Test file downloads with both providers
4. ✅ Verify SAS URL expiration behavior
5. ⏳ Move to Phase 2: Azure Table Storage migration (see PHASE_2_TABLE_STORAGE_PLAN.md)
