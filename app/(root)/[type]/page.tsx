import React from "react";
import Sort from "@/components/Sort";
import { getFiles } from "@/lib/actions/file.actions";
import { Models } from "node-appwrite";
import Card from "@/components/Card";
import { convertFileSize, getFileTypesParams } from "@/lib/utils";

const Page = async ({ searchParams, params }: SearchParamProps) => {
  const type = ((await params)?.type as string) || "";
  const searchText = ((await searchParams)?.query as string) || "";
  const sort = ((await searchParams)?.sort as string) || "";

  const types = getFileTypesParams(type) as FileType[];

  const files = await getFiles({ types, searchText, sort });

  // get total file size from files.documents.map(file -> file.size)
  // print total filesize uisng above formula and print below

  // how can i ignore typescript error here?
  // const totalFileSize = files.documents.reduce((total:any, file: any) => total + file.size, 0);
  // ignore typescript error here
  const totalFileSize = files.documents.reduce((total: number, file: Models.Document) => total + file.size, 0);
  // convert totalFileSize to human readable KB, MB, GB, TB, etc
  const totalFileSizeHumanReadable = convertFileSize(totalFileSize);

  return (
    <div className="page-container">
      <section className="w-full">
        <h1 className="h1 capitalize">{type}</h1>

        <div className="total-size-section">
          <p className="body-1">
            {/* get total file size from files.documents.map(file -> file.size) */}
            {/* print total filesize uisng above formula and print below */}
            
            Total: <span className="h5">{totalFileSizeHumanReadable}</span>
          </p>

          <div className="sort-container">
            <p className="body-1 hidden text-light-200 sm:block">Sort by:</p>

            <Sort />
          </div>
        </div>
      </section>

      {/* Render the files */}
      {files.total > 0 ? (
        <section className="file-list">
          {files.documents.map((file: Models.Document) => (
            <Card key={file.$id} file={file} />
          ))}
        </section>
      ) : (
        <p className="empty-list">No files uploaded</p>
      )}
    </div>
  );
};

export default Page;
