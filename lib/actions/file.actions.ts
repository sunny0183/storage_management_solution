"use server";

import { getFileType, parseStringify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/actions/user.actions";
import { getStorageProvider } from "@/lib/storage/factory";
import { getFilesDatabaseProvider } from "@/lib/database/factory";
import type { FileMetadata } from "@/lib/database/types";

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
  const dbProvider = getFilesDatabaseProvider();

  try {
    // Upload file to storage (Appwrite or Azure based on env var)
    const uploadResult = await storageProvider.uploadFile(file);

    const fileDocument: Omit<FileMetadata, "$id"> = {
      type: getFileType(uploadResult.fileName).type as FileType,
      name: uploadResult.fileName,
      url: storageProvider.getFileUrl(uploadResult.fileId),
      extension: getFileType(uploadResult.fileName).extension,
      size: uploadResult.fileSize,
      owner: ownerId,
      accountId,
      users: [],
      bucketFileId: uploadResult.fileId, // Stores Azure blob name OR Appwrite bucketFileId
    };

    const newFile = await dbProvider
      .createFile(fileDocument)
      .catch(async (error: unknown) => {
        // Rollback: delete from storage if DB insert fails
        await storageProvider.deleteFile(uploadResult.fileId);
        console.error(error, "Failed to create file document");
        throw new Error("Failed to save file metadata");
      });

    revalidatePath(path);
    return parseStringify({ success: true, file: newFile });
  } catch (error) {
    console.error(error, "Failed to upload file");
    const errorMessage = error instanceof Error ? error.message : "Failed to upload file. Please try again.";
    return parseStringify({ success: false, error: errorMessage });
  }
};

export const getFiles = async ({
  types = [],
  searchText = "",
  sort = "$createdAt-desc",
  limit,
}: GetFilesProps) => {
  const dbProvider = getFilesDatabaseProvider();

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

    return parseStringify(result);
  } catch (error) {
    console.error(error, "Failed to get files");
    return parseStringify({ documents: [], total: 0 });
  }
};

export const renameFile = async ({
  fileId,
  name,
  extension,
  path,
}: RenameFileProps) => {
  const dbProvider = getFilesDatabaseProvider();

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
  const dbProvider = getFilesDatabaseProvider();

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
  const dbProvider = getFilesDatabaseProvider();

  try {
    await dbProvider.deleteFile(fileId);
    await storageProvider.deleteFile(bucketFileId);

    revalidatePath(path);
    return parseStringify({ status: "success" });
  } catch (error) {
    handleError(error, "Failed to delete file");
  }
};

export const getFileDownloadUrl = async (bucketFileId: string) => {
  try {
    const storageProvider = getStorageProvider();
    return storageProvider.getDownloadUrl(bucketFileId);
  } catch (error) {
    handleError(error, "Failed to get download URL");
  }
};

// ============================== TOTAL FILE SPACE USED
export async function getTotalSpaceUsed() {
  try {
    const dbProvider = getFilesDatabaseProvider();
    const currentUser = await getCurrentUser();

    if (!currentUser) throw new Error("User is not authenticated.");

    const totalSpace = await dbProvider.getTotalSpaceByOwner(currentUser.$id);

    return parseStringify(totalSpace);
  } catch (error) {
    console.error(error, "Error calculating total space used");
    return parseStringify({
      image: { size: 0, latestDate: "" },
      document: { size: 0, latestDate: "" },
      video: { size: 0, latestDate: "" },
      audio: { size: 0, latestDate: "" },
      other: { size: 0, latestDate: "" },
      used: 0,
      all: 2 * 1024 * 1024 * 1024,
    });
  }
}
