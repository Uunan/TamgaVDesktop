import type {
  AuthStatus,
  DesktopMeta,
  LinuxAppInfo,
  LinuxRuntimeStatus,
  RunningLinuxSession,
  SystemInfoResponse,
  VFSNode,
  VirtualDesktopInfo,
} from '../types/os';

export interface VFSSnapshot {
  nodes: VFSNode[];
  meta: DesktopMeta;
  desktop?: VirtualDesktopInfo;
  desktops?: VirtualDesktopInfo[];
}

let activeDesktopId = 'main';

export function setBridgeDesktopId(id: string) {
  activeDesktopId = id || 'main';
}

export function getBridgeDesktopId(): string {
  return activeDesktopId;
}

export function buildRawFileUrl(virtualPath: string, extraQuery = ''): string {
  return `/api/vfs/raw?desktop=${encodeURIComponent(activeDesktopId)}&path=${encodeURIComponent(
    virtualPath
  )}${extraQuery}`;
}

export function buildWallpaperUrl(fileName: string): string {
  return `/api/vfs/wallpaper/${encodeURIComponent(fileName)}?desktop=${encodeURIComponent(
    activeDesktopId
  )}`;
}

export function buildAppIconUrl(iconName: string): string {
  return `/api/apps/icon?name=${encodeURIComponent(iconName)}`;
}

async function jsonReq<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Desktop-Id': activeDesktopId,
      ...(options?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'İşlem sırasında bir hata oluştu.');
  }
  return data as T;
}

export const authApi = {
  status: () => jsonReq<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string) =>
    jsonReq<{ ok: boolean; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    jsonReq<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  changePassword: (password: string) =>
    jsonReq<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
};

export const systemApi = {
  info: () => jsonReq<SystemInfoResponse>('/api/system/info'),
};

export const appsApi = {
  list: () =>
    jsonReq<{
      runtime: LinuxRuntimeStatus;
      apps: LinuxAppInfo[];
      runningSessions: RunningLinuxSession[];
      allowInstall: boolean;
    }>('/api/apps'),

  launch: (params: {
    appId?: string;
    command?: string;
    appName?: string;
    initialUrl?: string;
    needsNoSandbox?: boolean;
    width?: number;
    height?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  }) =>
    jsonReq<RunningLinuxSession>('/api/apps/launch', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  close: (sessionId: string, viewId?: string) =>
    jsonReq<{ ok: boolean }>('/api/apps/close', {
      method: 'POST',
      body: JSON.stringify({ sessionId, viewId }),
    }),

  install: (params: { appId?: string; aptPackage?: string }) =>
    jsonReq<{ jobId: string }>('/api/apps/install', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  uninstall: (params: { appId?: string; aptPackage?: string }) =>
    jsonReq<{ jobId: string }>('/api/apps/uninstall', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  searchApt: (query: string) =>
    jsonReq<{ results: Array<{ packageName: string; summary: string; installed: boolean }> }>(
      `/api/apps/search?q=${encodeURIComponent(query)}`
    ),

  openFiles: (sessionId: string, vfsPaths: string[]) =>
    jsonReq<{ ok: boolean }>('/api/apps/open-files', {
      method: 'POST',
      body: JSON.stringify({ sessionId, vfsPaths }),
    }),

  getInstallJob: (jobId: string) =>
    jsonReq<{ status: 'running' | 'done' | 'error'; log: string }>(
      `/api/apps/install/${encodeURIComponent(jobId)}`
    ),

  startVSCodeWeb: (folderPath?: string, theme?: 'dark' | 'light') =>
    jsonReq<{ url: string }>('/api/apps/vscode-start', {
      method: 'POST',
      body: JSON.stringify({ folderPath, theme }),
    }),

  vscodeStatus: () =>
    jsonReq<{ installed: boolean; ready: boolean; statusMessage: string }>(
      '/api/apps/vscode-status'
    ),
};

export const vfsApi = {
  listDesktops: () => jsonReq<{ desktops: VirtualDesktopInfo[] }>('/api/desktops'),

  createDesktop: (name?: string) =>
    jsonReq<{ desktop: VirtualDesktopInfo; desktops: VirtualDesktopInfo[] }>('/api/desktops', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  renameDesktop: (id: string, name: string) =>
    jsonReq<{ desktop: VirtualDesktopInfo; desktops: VirtualDesktopInfo[] }>(
      `/api/desktops/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }
    ),

  deleteDesktop: (id: string) =>
    jsonReq<{ desktops: VirtualDesktopInfo[] }>(`/api/desktops/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getSnapshot: () => jsonReq<VFSSnapshot>('/api/vfs/snapshot'),

  createFolder: (parentPath: string, name: string, pos?: { x: number; y: number }) =>
    jsonReq<{ node: VFSNode; snapshot: VFSSnapshot }>('/api/vfs/folder', {
      method: 'POST',
      body: JSON.stringify({ parentPath, name, pos }),
    }),

  createFile: (
    parentPath: string,
    name: string,
    content?: string,
    pos?: { x: number; y: number }
  ) =>
    jsonReq<{ node: VFSNode; snapshot: VFSSnapshot }>('/api/vfs/file', {
      method: 'POST',
      body: JSON.stringify({ parentPath, name, content, pos }),
    }),

  rename: (path: string, newName: string) =>
    jsonReq<{ node: VFSNode; snapshot: VFSSnapshot }>('/api/vfs/rename', {
      method: 'POST',
      body: JSON.stringify({ path, newName }),
    }),

  move: (paths: string[], targetDir: string) =>
    jsonReq<{ moved: VFSNode[]; snapshot: VFSSnapshot }>('/api/vfs/move', {
      method: 'POST',
      body: JSON.stringify({ paths, targetDir }),
    }),

  copy: (paths: string[], targetDir: string) =>
    jsonReq<{ copied: VFSNode[]; snapshot: VFSSnapshot }>('/api/vfs/copy', {
      method: 'POST',
      body: JSON.stringify({ paths, targetDir }),
    }),

  trash: (paths: string[]) =>
    jsonReq<{ snapshot: VFSSnapshot }>('/api/vfs/trash', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),

  restore: (paths: string[]) =>
    jsonReq<{ restored: VFSNode[]; snapshot: VFSSnapshot }>('/api/vfs/restore', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),

  deletePermanently: (paths: string[]) =>
    jsonReq<{ snapshot: VFSSnapshot }>('/api/vfs/delete', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),

  emptyTrash: () =>
    jsonReq<{ snapshot: VFSSnapshot }>('/api/vfs/empty-trash', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  compressToZip: (paths: string[], targetDir: string, zipName?: string) =>
    jsonReq<{ node: VFSNode; snapshot: VFSSnapshot }>('/api/vfs/zip', {
      method: 'POST',
      body: JSON.stringify({ paths, targetDir, zipName }),
    }),

  extractZip: (path: string, targetDir?: string) =>
    jsonReq<{ node: VFSNode; snapshot: VFSSnapshot }>('/api/vfs/unzip', {
      method: 'POST',
      body: JSON.stringify({ path, targetDir }),
    }),

  readText: (path: string) =>
    jsonReq<{ content: string; node: VFSNode }>(
      `/api/vfs/content?path=${encodeURIComponent(path)}`
    ),

  writeText: (path: string, content: string) =>
    jsonReq<{ node: VFSNode; snapshot: VFSSnapshot }>('/api/vfs/content', {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),

  uploadFiles: async (parentPath: string, files: FileList | File[]) => {
    const form = new FormData();
    form.append('parentPath', parentPath);
    Array.from(files).forEach((f) => form.append('files', f));
    const res = await fetch('/api/vfs/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Desktop-Id': activeDesktopId },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Dosya yükleme başarısız oldu.');
    return data as { saved: VFSNode[]; snapshot: VFSSnapshot };
  },

  uploadWallpaper: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/vfs/wallpaper', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Desktop-Id': activeDesktopId },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Arka plan yüklenemedi.');
    return data as { meta: DesktopMeta };
  },

  setWallpaperFromVfs: (path: string) =>
    jsonReq<{ meta: DesktopMeta }>('/api/vfs/wallpaper-from-vfs', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  updateMeta: (partial: {
    positions?: Record<string, { x: number; y: number }>;
    preferences?: Partial<
      Omit<
        DesktopMeta['preferences'],
        'stream' | 'browser' | 'terminal' | 'ui' | 'dock' | 'media' | 'screensaver' | 'lockScreen'
      > & {
        stream?: Partial<DesktopMeta['preferences']['stream']>;
        browser?: Partial<DesktopMeta['preferences']['browser']>;
        terminal?: Partial<DesktopMeta['preferences']['terminal']>;
        ui?: Partial<DesktopMeta['preferences']['ui']>;
        dock?: Partial<DesktopMeta['preferences']['dock']>;
        media?: Partial<NonNullable<DesktopMeta['preferences']['media']>>;
        screensaver?: Partial<NonNullable<DesktopMeta['preferences']['screensaver']>>;
        lockScreen?: Partial<NonNullable<DesktopMeta['preferences']['lockScreen']>>;
      }
    >;
  }) =>
    jsonReq<{ meta: DesktopMeta }>('/api/vfs/meta', {
      method: 'PATCH',
      body: JSON.stringify(partial),
    }),

  resetPositions: () =>
    jsonReq<{ meta: DesktopMeta }>('/api/vfs/reset-positions', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

export const mediaApi = {
  status: () =>
    jsonReq<{
      pulseRunning: boolean;
      sinks: Array<{ id: string; name: string; state: string }>;
      sources: Array<{ id: string; name: string; state: string }>;
      virtualMicName: string;
      virtualMicReady: boolean;
      virtualMicActiveClients: number;
      videoDevices: string[];
      v4l2LoopbackReady: boolean;
      cameraNote: string;
    }>('/api/media/status'),
  setupMic: () =>
    jsonReq<{ ready: boolean; sourceName: string }>('/api/media/setup-mic', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  setupCamera: (installDriver = false) =>
    jsonReq<{ ready: boolean; videoDevices: string[]; note: string }>('/api/media/setup-camera', {
      method: 'POST',
      body: JSON.stringify({ installDriver }),
    }),
};

export const webAppApi = {
  syncChromeCookies: () =>
    jsonReq<{ importedCount: number }>('/web-app-proxy/sync-chrome-cookies', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
