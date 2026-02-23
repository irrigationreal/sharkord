import { UploadHeaders, type TTempFile } from '@sharkord/shared';
import { toast } from 'sonner';
import { getValidSessionToken } from './auth-session';
import { getUrlFromServer } from './get-file-url';

const uploadFile = async (file: File) => {
  const url = getUrlFromServer();
  const token = await getValidSessionToken();

  const res = await fetch(`${url}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      [UploadHeaders.TYPE]: file.type,
      [UploadHeaders.CONTENT_LENGTH]: file.size.toString(),
      [UploadHeaders.ORIGINAL_NAME]: file.name,
      [UploadHeaders.TOKEN]: token
    },
    body: file
  });

  if (!res.ok) {
    const errorData = await res.json();

    toast.error(errorData.error || res.statusText);

    return undefined;
  }

  const tempFile: TTempFile = await res.json();

  return tempFile;
};

const uploadFiles = async (files: File[]) => {
  const uploadedFiles: TTempFile[] = [];

  for (const file of files) {
    const uploadedFile = await uploadFile(file);

    if (!uploadedFile) continue;

    uploadedFiles.push(uploadedFile);
  }

  return uploadedFiles;
};

export { uploadFile, uploadFiles };
