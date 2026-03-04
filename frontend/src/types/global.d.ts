import type { BackendApi } from "./ipc";

declare global {
  interface Window {
    localTranscribeBackend: BackendApi;
  }
}

export {};
