import { contextBridge, ipcRenderer } from 'electron';

export type RendererIpc = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  on: <T = unknown>(channel: string, listener: (payload: T) => void) => void;
  off: <T = unknown>(channel: string, listener: (payload: T) => void) => void;
};

// Track listener wrappers so off() can remove the correct handler
type RendererListener = (payload: unknown) => void;
type IpcListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => void;
const listenerWrappers = new WeakMap<RendererListener, IpcListener>();

const api: RendererIpc = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const rendererListener = listener as RendererListener;
    const wrapper: IpcListener = (_event, ...rest) => rendererListener(rest[0]);
    listenerWrappers.set(rendererListener, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  off: (channel, listener) => {
    const rendererListener = listener as RendererListener;
    const wrapper = listenerWrappers.get(rendererListener);
    if (wrapper) {
      ipcRenderer.off(channel, wrapper);
      listenerWrappers.delete(rendererListener);
    }
  },
};

contextBridge.exposeInMainWorld('solbot', api);

ipcRenderer.on('logs:stream', (_event, payload) => {
  window.dispatchEvent(new CustomEvent('solbot-log', { detail: payload }));
});

declare global {
  interface Window {
    solbot: RendererIpc;
  }
}
