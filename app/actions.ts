"use server";

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { getSql } from "@/lib/db";
import { setPaused } from "@/lib/settings";
import { publishNextStory } from "@/lib/publish";

/** Inserts a media row after the browser finishes uploading to Vercel Blob. */
export async function addMedia(input: {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  caption: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    insert into media (blob_url, pathname, content_type, size_bytes, caption)
    values (${input.url}, ${input.pathname}, ${input.contentType}, ${input.size}, ${input.caption.trim()})
  `;
  revalidatePath("/");
}

export async function toggleMedia(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  const sql = getSql();
  await sql`update media set enabled = ${enabled} where id = ${id}`;
  revalidatePath("/");
}

export async function deleteMedia(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const sql = getSql();
  const rows = await sql`delete from media where id = ${id} returning blob_url`;
  const blobUrl = rows[0]?.blob_url as string | undefined;
  if (blobUrl) {
    await del(blobUrl).catch(() => undefined);
  }
  revalidatePath("/");
}

export async function togglePause(formData: FormData): Promise<void> {
  await setPaused(formData.get("paused") === "true");
  revalidatePath("/");
}

export async function publishNow(): Promise<void> {
  await publishNextStory();
  revalidatePath("/");
}
