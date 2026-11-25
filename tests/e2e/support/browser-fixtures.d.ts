export {};

declare global {
  interface Window {
    installPromptDeferred: boolean;
    promptCalls: number;
    recordWarrantyCopy(value: string): Promise<void>;
    releasePhotoRead(): Promise<void>;
    telemetryPending: Promise<unknown>;
    warrantyCameraRequests: number;
  }
}
