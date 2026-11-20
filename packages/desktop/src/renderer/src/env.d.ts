import type { DesktopApi } from "../../shared/ipc";

declare global {
  interface Window {
    ao: DesktopApi;
  }
}

export {};
