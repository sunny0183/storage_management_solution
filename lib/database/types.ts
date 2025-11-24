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
