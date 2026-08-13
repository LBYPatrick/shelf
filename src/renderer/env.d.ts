/// <reference types="vite/client" />

import type { ShelfApi } from '../preload';

declare global {
  interface Window {
    readonly shelf: ShelfApi;
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

export {};
