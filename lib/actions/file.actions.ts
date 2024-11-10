"use server";

import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { InputFile } from "node-appwrite/file";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID, Models, Query } from "node-appwrite";
import { constructFileUrl, getFileType, parseStringify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/actions/user.actions";
import fs from "fs";

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
  const { storage, databases } = await createAdminClient();
  // write storage and databases into a json file
  fs.writeFileSync(`file.actions.uploadFile.storage.json`, JSON.stringify(storage, null, 2));
  fs.writeFileSync(`file.actions.uploadFile.databases.json`, JSON.stringify(databases, null, 2));


  try {
    const inputFile = InputFile.fromBuffer(file, file.name);

    const bucketFile = await storage.createFile(
      appwriteConfig.bucketId,
      ID.unique(),
      inputFile,
    );
    // write bucketFile into a json file
    fs.writeFileSync(`file.actions.uploadFile.bucketFile.json`, JSON.stringify(bucketFile, null, 2));

    const fileDocument = {
      type: getFileType(bucketFile.name).type,
      name: bucketFile.name,
      url: constructFileUrl(bucketFile.$id),
      extension: getFileType(bucketFile.name).extension,
      size: bucketFile.sizeOriginal,
      owner: ownerId,
      accountId,
      users: [],
      bucketFileId: bucketFile.$id,
    };
    // write fileDocument into a json file
    fs.writeFileSync(`file.actions.uploadFile.fileDocument.json`, JSON.stringify(fileDocument, null, 2));

    const newFile = await databases
      .createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.filesCollectionId,
        ID.unique(),
        fileDocument,
      )
      .catch(async (error: unknown) => {
        await storage.deleteFile(appwriteConfig.bucketId, bucketFile.$id);
        handleError(error, "Failed to create file document");
      });
    // write newFile into a json file
    fs.writeFileSync(`file.actions.uploadFile.newFile.json`, JSON.stringify(newFile, null, 2));

    revalidatePath(path);
    return parseStringify(newFile);
  } catch (error) {
    handleError(error, "Failed to upload file");
  }
};

const createQueries = (
  currentUser: Models.Document,
  types: string[],
  searchText: string,
  sort: string,
  limit?: number,
) => {
  const queries = [
    Query.or([
      Query.equal("owner", [currentUser.$id]),
      Query.contains("users", [currentUser.email]),
    ]),
  ];

  if (types.length > 0) queries.push(Query.equal("type", types));
  if (searchText) queries.push(Query.contains("name", searchText));
  if (limit) queries.push(Query.limit(limit));

  if (sort) {
    const [sortBy, orderBy] = sort.split("-");

    queries.push(
      orderBy === "asc" ? Query.orderAsc(sortBy) : Query.orderDesc(sortBy),
    );
  }

  // write queries into a json file
  fs.writeFileSync(`file.actions.getFiles.queries.json`, JSON.stringify(queries, null, 2));

  return queries;
};

export const getFiles = async ({
  types = [],
  searchText = "",
  sort = "$createdAt-desc",
  limit,
}: GetFilesProps) => {
  const { databases } = await createAdminClient();

  try {
    const currentUser = await getCurrentUser();

    //  write currentUser into a json file
    fs.writeFileSync(`file.actions.getFiles.currentUser.json`, JSON.stringify(currentUser, null, 2));

    if (!currentUser) throw new Error("User not found");

    const queries = createQueries(currentUser, types, searchText, sort, limit);

    const files = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      queries,
    );

    // write files into a json file
    fs.writeFileSync(`file.actions.getFiles.files.json`, JSON.stringify(files, null, 2));

    console.log({ files });
    return parseStringify(files);
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
  const { databases } = await createAdminClient();

  // write databases into a json file
  fs.writeFileSync(`file.actions.renameFile.databases.json`, JSON.stringify(databases, null, 2));

  try {
    const newName = `${name}.${extension}`;
    const updatedFile = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId,
      {
        name: newName,
      },
    );
    // write updatedFile into a json file
    fs.writeFileSync(`file.actions.renameFile.updatedFile.json`, JSON.stringify(updatedFile, null, 2));

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
  const { databases } = await createAdminClient();

  try {
    const updatedFile = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId,
      {
        users: emails,
      },
    );
    // write updatedFile into a json file. make sure the format is json not string
    fs.writeFileSync(`file.actions.updateFileUsers.updatedFile.json`, JSON.stringify(updatedFile, null, 2));

    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

export const deleteFile = async ({
  fileId,
  bucketFileId,
  path,
}: DeleteFileProps) => {
  const { databases, storage } = await createAdminClient();
  // write databases and storage into a json file
  fs.writeFileSync(`file.actions.deleteFile.databases.json`, JSON.stringify(databases, null, 2));
  fs.writeFileSync(`file.actions.deleteFile.storage.json`, JSON.stringify(storage, null, 2));


  try {
    const deletedFile = await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId,
    );
    // write deletedFile into a json file
    fs.writeFileSync(`file.actions.deleteFile.deletedFile.json`, JSON.stringify(deletedFile, null, 2));

    if (deletedFile) {
      await storage.deleteFile(appwriteConfig.bucketId, bucketFileId);
    }

    revalidatePath(path);
    return parseStringify({ status: "success" });
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

// ============================== TOTAL FILE SPACE USED
export async function getTotalSpaceUsed() {
  try {
    const { databases } = await createSessionClient();
    // write databases into a json file
    fs.writeFileSync(`file.actions.getTotalSpaceUsed.databases.json`, JSON.stringify(databases, null, 2));

    const currentUser = await getCurrentUser();

    if (!currentUser) throw new Error("User is not authenticated.");
    // write currentUser into a json file
    fs.writeFileSync(`file.actions.getTotalSpaceUsed.currentUser.json`, JSON.stringify(currentUser, null, 2));


    const files = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      [Query.equal("owner", [currentUser.$id])],
    );

    // write files into a json file
    fs.writeFileSync(`file.actions.getTotalSpaceUsed.files.json`, JSON.stringify(files, null, 2));

    const totalSpace = {
      image: { size: 0, latestDate: "" },
      document: { size: 0, latestDate: "" },
      video: { size: 0, latestDate: "" },
      audio: { size: 0, latestDate: "" },
      other: { size: 0, latestDate: "" },
      used: 0,
      all: 2 * 1024 * 1024 * 1024 /* 2GB available bucket storage */,
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

    // write totalSpace into a json file
    fs.writeFileSync(`file.actions.getTotalSpaceUsed.totalSpace.json`, JSON.stringify(totalSpace, null, 2));
    return parseStringify(totalSpace);
  } catch (error) {
    handleError(error, "Error calculating total space used:, ");
  }
}
