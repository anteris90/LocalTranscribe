import { contextBridge, ipcRenderer } from "electron";

type BackendRequestPayload = {
	method: string;
	params?: Record<string, unknown>;
};

type Unsubscribe = () => void;

const backendApi = {
	request: (payload: BackendRequestPayload): Promise<Record<string, unknown>> =>
		ipcRenderer.invoke("backend:request", payload),
	saveFile: (payload: { suggestedName: string; extension: "txt" | "srt" | "json"; content: string }): Promise<{ canceled: boolean; savedPath?: string }> =>
		ipcRenderer.invoke("export:saveFile", payload),
	onNotification: (listener: (payload: Record<string, unknown>) => void): Unsubscribe => {
		const wrapped = (_event: Electron.IpcRendererEvent, payload: Record<string, unknown>) => listener(payload);
		ipcRenderer.on("backend:notification", wrapped);
		return () => ipcRenderer.removeListener("backend:notification", wrapped);
	},
	onError: (listener: (payload: Record<string, unknown>) => void): Unsubscribe => {
		const wrapped = (_event: Electron.IpcRendererEvent, payload: Record<string, unknown>) => listener(payload);
		ipcRenderer.on("backend:error", wrapped);
		return () => ipcRenderer.removeListener("backend:error", wrapped);
	},
	onState: (listener: (payload: Record<string, unknown>) => void): Unsubscribe => {
		const wrapped = (_event: Electron.IpcRendererEvent, payload: Record<string, unknown>) => listener(payload);
		ipcRenderer.on("backend:state", wrapped);
		return () => ipcRenderer.removeListener("backend:state", wrapped);
	},
};

contextBridge.exposeInMainWorld("localTranscribeBackend", backendApi);

export {};
