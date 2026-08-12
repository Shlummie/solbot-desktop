import { dialog, type BrowserWindow, type FileFilter } from 'electron';

export const openFileDialog = async (window: BrowserWindow | undefined, filters?: FileFilter[]) => {
  if (!window) {
    return undefined;
  }
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: filters ?? [],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  return result.filePaths[0];
};

export const saveFileDialog = async (window: BrowserWindow | undefined, filters?: FileFilter[]) => {
  if (!window) {
    return undefined;
  }
  const result = await dialog.showSaveDialog(window, {
    filters: filters ?? [],
  });
  if (result.canceled || !result.filePath) {
    return undefined;
  }
  return result.filePath;
};

