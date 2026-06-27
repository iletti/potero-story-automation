import { JWT } from "google-auth-library";

/**
 * Read-only Google Drive access via a service account. Share your Drive folder
 * with the service account's email and it can list + stream the files.
 */

let client: JWT | null = null;

function getClient(): JWT {
  if (client) return client;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set (paste the service-account key file).");
  }
  let creds: { client_email?: string; private_key?: string };
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email / private_key.");
  }
  client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return client;
}

async function accessToken(): Promise<string> {
  const { token } = await getClient().getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  return token;
}

function folderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set.");
  return id;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  modifiedTime: string;
};

/** Lists every (non-trashed) file directly in the configured folder. */
export async function listFolder(): Promise<DriveFile[]> {
  const token = await accessToken();
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId()}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id,name,mimeType,size,modifiedTime,imageMediaMetadata,videoMediaMetadata)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Drive list failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime: string;
        imageMediaMetadata?: { width?: number; height?: number };
        videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
      }>;
    };

    for (const f of data.files ?? []) {
      const img = f.imageMediaMetadata;
      const vid = f.videoMediaMetadata;
      files.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number(f.size ?? 0),
        width: img?.width ?? vid?.width,
        height: img?.height ?? vid?.height,
        durationMs: vid?.durationMillis ? Number(vid.durationMillis) : undefined,
        modifiedTime: f.modifiedTime,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/** Streams a file's bytes (for piping straight to Outstand). */
export async function downloadStream(fileId: string): Promise<ReadableStream<Uint8Array>> {
  const token = await accessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Drive download failed (${res.status}) for file ${fileId}.`);
  }
  return res.body;
}
