# Storage Management Solution - AI Agent Instructions

## Project Overview

A Next.js 15 file storage and sharing platform using Appwrite as the BaaS (Backend-as-a-Service). Users can upload, organize, share files with email-based authentication via OTP. The app categorizes files by type (documents, images, media, others) and provides a dashboard with storage analytics.

## Architecture & Key Patterns

### Directory Structure

- `app/(auth)/` - Authentication routes (sign-in, sign-up) with split-screen layout
- `app/(root)/` - Protected routes with sidebar navigation and header
- `app/(root)/[type]/` - Dynamic routes for file type filtering (documents, images, media, others)
- `lib/actions/` - Server actions for Appwrite operations (prefix with "use server")
- `lib/appwrite/` - Appwrite client configuration (admin vs session clients)
- `components/` - React components, both client and server components
- `components/ui/` - shadcn/ui components

### Server Actions Pattern

**Critical**: All data operations use Next.js Server Actions marked with `"use server"` directive at the top of files in `lib/actions/`. These are the ONLY way to interact with Appwrite:

- `lib/actions/user.actions.ts` - Authentication, user management
- `lib/actions/file.actions.ts` - File CRUD, storage operations

Example pattern from codebase:

```typescript
"use server";
export const uploadFile = async ({
  file,
  ownerId,
  accountId,
  path,
}: UploadFileProps) => {
  const { storage, databases } = await createAdminClient();
  // ... implementation
  revalidatePath(path); // Always revalidate after mutations
};
```

### Appwrite Client Types

Two distinct client patterns in `lib/appwrite/index.ts`:

1. **Session Client** - Uses cookie-based session, for authenticated user operations
   - Returns: `{ account, databases }`
   - Used in: `getCurrentUser()`, `getTotalSpaceUsed()`
2. **Admin Client** - Uses API key, for privileged operations
   - Returns: `{ account, databases, storage, avatars }`
   - Used in: file uploads, user creation, all mutations

### Authentication Flow

1. User submits email → `sendEmailOTP()` generates token
2. Appwrite sends OTP to email → User enters code
3. `verifySecret()` creates session → Sets `appwrite-session` cookie
4. Protected layouts check `getCurrentUser()` → Redirects if not authenticated

**Email-only auth** - No passwords stored. OTP sent via Appwrite's email token system.

### File Type System

Files categorized by extension in `lib/utils.ts` `getFileType()`:

- `document` - pdf, doc, docx, txt, csv, xls, xlsx, etc.
- `image` - jpg, jpeg, png, gif, bmp, svg, webp
- `video` - mp4, avi, mov, mkv, webm
- `audio` - mp3, wav, ogg, flac

File routes use this mapping via `getFileTypesParams()` helper.

### Route Groups & Layouts

- `(auth)` group - Public routes, side-by-side layout (form + brand section)
- `(root)` group - Protected routes, requires authentication check in layout:
  ```typescript
  const currentUser = await getCurrentUser();
  if (!currentUser) return redirect("/sign-in");
  ```
  Renders: Sidebar + MobileNavigation + Header + children

### Dynamic Routing Pattern

`app/(root)/[type]/page.tsx` handles `/documents`, `/images`, `/media`, `/others`:

```typescript
const type = ((await params)?.type as string) || "";
const types = getFileTypesParams(type) as FileType[];
const files = await getFiles({ types, searchText, sort });
```

## Component Conventions

### Client vs Server Components

- **Server components** (default) - Dashboard, layouts, type pages - fetch data directly
- **Client components** - Forms, modals, interactive UI - must have `"use client"` directive
- Forms use `react-hook-form` + `zod` validation (see `AuthForm.tsx`)

### Styling System

- **Tailwind CSS** - All styling via utility classes
- **Custom utility classes** - Defined in `globals.css` under `@layer utilities`
  - Typography: `.h1` to `.h5`, `.body-1`, `.body-2`, `.button`, `.caption`
  - Components: `.auth-form`, `.dashboard-container`, `.file-card`, etc.
- **shadcn/ui overrides** - Prefix: `.shad-*` (e.g., `.shad-form-item`, `.shad-input`)
- **Color palette** - `brand` (pink/red), `light-*`, `dark-*` defined in `tailwind.config.ts`

### Revalidation Pattern

After any mutation (upload, rename, delete, share), call `revalidatePath(path)` to refresh cached data:

```typescript
await databases.updateDocument(...);
revalidatePath(path); // Pass current route path
return parseStringify(updatedFile);
```

## Development Workflow

### Running the App

```bash
npm run dev          # Start dev server with Turbopack (--turbopack flag)
npm run build        # Production build
npm run start        # Serve production build
npm run lint         # ESLint check
```

### Environment Variables

Required in `.env.local`:

```
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT=<project_id>
NEXT_PUBLIC_APPWRITE_DATABASE=<database_id>
NEXT_PUBLIC_APPWRITE_USERS_COLLECTION=<users_collection_id>
NEXT_PUBLIC_APPWRITE_FILES_COLLECTION=<files_collection_id>
NEXT_PUBLIC_APPWRITE_BUCKET=<bucket_id>
NEXT_APPWRITE_KEY=<api_key>  # Server-side only (no NEXT_PUBLIC prefix)
```

### Appwrite Setup Requirements (Current)

1. Create project at https://cloud.appwrite.io
2. Create database with two collections:
   - **users** - `fullName` (string), `email` (string), `avatar` (URL), `accountId` (string)
   - **files** - `name`, `type`, `url`, `extension`, `size`, `owner`, `accountId`, `users` (array), `bucketFileId`
3. Create storage bucket (2GB limit referenced in code)
4. Enable email/password authentication

### Azure Storage Setup (Migration Target)

Add to `.env.local` when implementing Azure storage:

```
STORAGE_PROVIDER=azure                    # Toggle: "appwrite" or "azure"
AZURE_STORAGE_CONNECTION_STRING=...       # Azure storage account connection string
AZURE_STORAGE_CONTAINER_NAME=user-files   # Container for file blobs
AZURE_STORAGE_ACCOUNT_NAME=...            # Storage account name
```

**DO NOT modify storage code directly** - implement via abstraction layer per `AZURE_MIGRATION_PLAN.md`

## Common Patterns & Helpers

### Utility Functions (`lib/utils.ts`)

- `parseStringify()` - Serialize/deserialize for Server Actions return values
- `convertFileSize()` - Bytes to KB/MB/GB display
- `formatDateTime()` - ISO string to "3:45pm, 15 Nov" format
- `constructFileUrl()` / `constructDownloadUrl()` - Build Appwrite storage URLs
- `getUsageSummary()` - Transform storage stats for dashboard cards

### Constants (`constants/index.ts`)

- `navItems` - Sidebar navigation config
- `actionsDropdownItems` - File action menu items
- `sortTypes` - Sort options for file lists
- `MAX_FILE_SIZE` - 50MB upload limit

### Type Definitions (`types/index.d.ts`)

Global TypeScript interfaces for props, no imports needed. Key types:

- `FileType` - Union of file categories
- `*Props` interfaces - Component/function parameter types
- Uses `Models.Document` from `node-appwrite` for Appwrite documents

## Current Branch Context & Migration

Working on `azure-storage-account` branch (not main). **Active migration from Appwrite to Azure Storage in progress**.

### Migration Strategy

**Phase 1 (Current)**: Migrate blob storage from Appwrite Storage to Azure Blob Storage

- Keep Appwrite database (users & files tables) for metadata
- Create storage abstraction layer for easy rollback
- Use feature flag (`STORAGE_PROVIDER` env var) to toggle between providers
- **See `AZURE_MIGRATION_PLAN.md` for detailed implementation plan**

### Critical Storage Points

- **Upload**: `lib/actions/file.actions.ts:uploadFile` - Uses `storage.createFile()`
- **Delete**: `lib/actions/file.actions.ts:deleteFile` - Uses `storage.deleteFile()`
- **URLs**: `lib/utils.ts` - `constructFileUrl()` and `constructDownloadUrl()`
- **Field**: `bucketFileId` in files collection stores storage identifier (Appwrite ID or Azure blob name)

## Debugging Tips

- Check browser console for client-side errors
- Server action errors log to terminal (not browser)
- Appwrite dashboard shows real-time database/storage activity
- Cookie `appwrite-session` stores auth state - clear to force logout
- Dynamic route segment accessed via `(await params)?.type` in Next.js 15

## Known Patterns to Maintain

- Always use route groups `(auth)` and `(root)` for new pages
- File operations require both `bucketFileId` (storage) and `fileId` (database)
- Email sharing stores array of emails in `files.users` field
- Dashboard shows latest 10 files across all types via `limit: 10`
- Storage chart calculated against hardcoded 2GB limit
- All dates stored/retrieved in ISO format, displayed via `formatDateTime()`
