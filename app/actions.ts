"use server";

import { revalidatePath } from "next/cache";
import { getSql } from "@/lib/db";
import { setPaused, updateSettings } from "@/lib/settings";
import { publishNextStory } from "@/lib/publish";
import { syncDrive } from "@/lib/sync";

export async function togglePause(formData: FormData): Promise<void> {
  await setPaused(formData.get("paused") === "true");
  revalidatePath("/");
}

/** Manual per-file override (e.g. re-enable a file disabled after failures). */
export async function toggleMedia(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  const sql = getSql();
  // Re-enabling clears the failure state so it can be retried.
  await sql`
    update media
    set enabled = ${enabled},
        fail_count = case when ${enabled} then 0 else fail_count end,
        retry_after = case when ${enabled} then null else retry_after end
    where id = ${id}
  `;
  revalidatePath("/");
}

export async function saveSettings(formData: FormData): Promise<void> {
  const cooldownDays = Number(formData.get("cooldownDays"));
  const dailyMin = Number(formData.get("dailyMin"));
  const dailyMax = Number(formData.get("dailyMax"));
  await updateSettings({
    minReuseHours: Math.max(1, cooldownDays) * 24,
    dailyMin,
    dailyMax,
  });
  revalidatePath("/");
}

export async function syncNow(): Promise<void> {
  await syncDrive();
  revalidatePath("/");
}

export async function publishNow(): Promise<void> {
  await publishNextStory(new Date(), { force: true });
  revalidatePath("/");
}
