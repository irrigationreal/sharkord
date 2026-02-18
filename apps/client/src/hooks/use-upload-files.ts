import {
  prepareStrictE2EEFileForUpload,
  registerStrictTempFileEnvelope,
  removeStrictTempFileEnvelope
} from '@/features/e2ee/shadow';
import { useCan, usePublicServerSettings } from '@/features/server/hooks';
import { uploadFile } from '@/helpers/upload-file';
import { Permission, type TTempFile } from '@sharkord/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

// TODO: check if it works in all browsers

const useUploadFiles = (disabled: boolean = false, channelId?: number) => {
  const [files, setFiles] = useState<TTempFile[]>([]);
  const filesRef = useRef<TTempFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingSize, setUploadingSize] = useState(0);
  const settings = usePublicServerSettings();
  const can = useCan();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // hackers gonna hack
  filesRef.current = files;

  const addFiles = useCallback((files: TTempFile[]) => {
    setFiles((prevFiles) => [...prevFiles, ...files]);
  }, []);

  const removeFile = useCallback((id: string) => {
    removeStrictTempFileEnvelope(id);
    setFiles((prevFiles) => prevFiles.filter((file) => file.id !== id));
  }, []);

  const clearFiles = useCallback(() => {
    filesRef.current.forEach((file) => removeStrictTempFileEnvelope(file.id));
    setFiles([]);
  }, []);

  const uploadWithCurrentMode = useCallback(
    async (filesToUpload: File[]): Promise<TTempFile[]> => {
      if (!channelId) {
        toast.error('E2EE uploads require a channel context');
        return [];
      }

      const uploadedFiles: TTempFile[] = [];

      for (const file of filesToUpload) {
        const prepared = await prepareStrictE2EEFileForUpload(file);
        const uploaded = await uploadFile(prepared.uploadFile);

        if (!uploaded) continue;

        registerStrictTempFileEnvelope(uploaded.id, prepared.envelope);

        uploadedFiles.push({
          ...uploaded,
          originalName: prepared.envelope.originalName,
          extension:
            prepared.envelope.originalName.split('.').pop()?.toLowerCase() || ''
        });
      }

      return uploadedFiles;
    },
    [channelId]
  );

  const openFileDialog = useCallback(() => {
    if (disabled) return;

    const canUpload = can(Permission.UPLOAD_FILES);
    const uploadEnabled = true;

    if (!settings?.storageUploadEnabled) return;

    if (!canUpload) {
      toast.error('You do not have permission to upload files.');
      return;
    }

    if (!uploadEnabled) {
      toast.error('File uploads are disabled on this server.');
      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, [can, settings, disabled]);

  const onFileDialogChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;

      const canUpload = can(Permission.UPLOAD_FILES);
      const uploadEnabled = true;

      if (!settings?.storageUploadEnabled) return;

      if (!canUpload) {
        toast.error('You do not have permission to upload files.');
        return;
      }

      if (!uploadEnabled) {
        toast.error('File uploads are disabled on this server.');
        return;
      }

      const list = event.currentTarget.files;
      if (!list || list.length === 0) return;

      const filesToUpload: File[] = Array.from(list);

      setUploading(true);

      const total = filesToUpload.reduce((acc, file) => acc + file.size, 0);

      setUploadingSize((size) => size + total);

      const uploaded = await uploadWithCurrentMode(filesToUpload);

      addFiles(uploaded);
      setUploading(false);
      setUploadingSize((size) => size - total);
    },
    [addFiles, can, settings, disabled, uploadWithCurrentMode]
  );

  useEffect(() => {
    if (!settings?.storageUploadEnabled || disabled) return;

    const canUpload = can(Permission.UPLOAD_FILES);
    const uploadEnabled = true;

    const handlePaste = async (event: ClipboardEvent) => {
      if (disabled) {
        return;
      }

      if (!canUpload) {
        toast.error('You do not have permission to upload files.');
        return;
      }

      if (!uploadEnabled) {
        toast.error('File uploads are disabled on this server.');
        return;
      }

      const items = event.clipboardData?.items ?? [];
      const filesToUpload: File[] = [];

      for (let i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue;

        const pastedFile = items[i].getAsFile();

        if (!pastedFile) continue;

        filesToUpload.push(pastedFile);
      }

      if (!filesToUpload.length) return;

      setUploading(true);

      const total = filesToUpload.reduce((acc, file) => acc + file.size, 0);

      setUploadingSize((size) => size + total);

      const files = await uploadWithCurrentMode(filesToUpload);

      addFiles(files);
      setUploading(false);
      setUploadingSize((size) => size - total);
    };

    const handleDrop = async (event: DragEvent) => {
      if (disabled) {
        event.preventDefault();
        return;
      }

      if (!canUpload) {
        toast.error('You do not have permission to upload files.');
        return;
      }

      if (!uploadEnabled) {
        toast.error('File uploads are disabled on this server.');
        return;
      }

      event.preventDefault();
      const filesToUpload: File[] = [];
      const items = event.dataTransfer?.items ?? [];
      const dFiles = event.dataTransfer?.files ?? [];

      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') {
            const file = items[i].getAsFile();
            if (file) filesToUpload.push(file);
          }
        }
      } else {
        for (let i = 0; i < dFiles.length; i++) {
          filesToUpload.push(dFiles[i]);
        }
      }

      if (!filesToUpload.length) return;

      setUploading(true);

      const total = filesToUpload.reduce((acc, file) => acc + file.size, 0);

      setUploadingSize((size) => size + total);

      const files = await uploadWithCurrentMode(filesToUpload);

      addFiles(files);
      setUploading(false);
      setUploadingSize((size) => size - total);
    };

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
    };

    document.addEventListener('paste', handlePaste);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [addFiles, can, settings, disabled, uploadWithCurrentMode]);

  const fileInputProps = useMemo(
    () => ({
      ref: fileInputRef,
      type: 'file' as const,
      multiple: true,
      onChange: onFileDialogChange,
      style: { display: 'none' }
    }),
    [onFileDialogChange]
  );

  return {
    files,
    removeFile,
    filesRef,
    clearFiles,
    uploading,
    uploadingSize,
    openFileDialog,
    fileInputProps
  };
};

export { useUploadFiles };
