import { getSql } from "@/lib/db";
import { getStoryChannels } from "@/lib/outstand";
import { getSettings } from "@/lib/settings";
import { getDailyPlan, syncOutstandPostStatuses } from "@/lib/publish";
import { publishNow, saveSettings, syncNow, toggleMedia, togglePause } from "./actions";

export const dynamic = "force-dynamic";

type MediaRow = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  status: string;
  reject_reason: string | null;
  enabled: boolean;
  fail_count: number;
  last_error: string | null;
  last_posted_at: string | null;
};

type PostRow = {
  id: string;
  status: string;
  provider_post_id: string | null;
  error: string | null;
  created_at: string;
  name: string | null;
};

function fmtBytes(bytes: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" });
}

function fmtDims(m: MediaRow): string {
  const parts: string[] = [];
  if (m.width && m.height) parts.push(`${m.width}×${m.height}`);
  if (m.duration_ms) parts.push(`${(m.duration_ms / 1000).toFixed(0)}s`);
  return parts.join(" · ") || "—";
}

function storyChannelLabel(): string {
  try {
    const channels = getStoryChannels();
    if (channels.length === 0) return "feed post";
    return channels.map((channel) => channel[0].toUpperCase() + channel.slice(1)).join(" + ");
  } catch {
    return "not configured";
  }
}

export default async function Home() {
  await syncOutstandPostStatuses();

  const sql = getSql();
  const settings = await getSettings();
  const plan = await getDailyPlan();

  const media = (await sql`
    select id, name, mime_type, size_bytes, width, height, duration_ms,
           status, reject_reason, enabled, fail_count, last_error, last_posted_at
    from media
    order by
      case status when 'active' then 0 when 'rejected' then 1 else 2 end,
      last_posted_at asc nulls first, name asc
  `) as MediaRow[];

  const posts = (await sql`
    select p.id, p.status, p.provider_post_id, p.error, p.created_at, m.name
    from post_log p
    left join media m on m.id = p.media_id
    order by p.created_at desc
    limit 15
  `) as PostRow[];

  const counts = {
    active: media.filter((m) => m.status === "active").length,
    rejected: media.filter((m) => m.status === "rejected").length,
    removed: media.filter((m) => m.status === "removed").length,
  };
  const cooldownDays = Math.round(settings.minReuseHours / 24);
  const channels = storyChannelLabel();

  return (
    <main>
      <div className="row spread">
        <h1>Potero Story Automation</h1>
        <span className="muted">Drive folder → Outstand → {channels}</span>
      </div>

      <div className={`banner ${settings.paused ? "paused" : "live"}`} style={{ marginTop: 16 }}>
        {settings.paused
          ? "Paused — no Stories are being published."
          : `Live — target ${plan.target} Stories today · ${plan.postedToday} posted so far.`}
      </div>

      <div className="row" style={{ gap: 24, marginBottom: 4 }}>
        <Stat label="In rotation" value={String(counts.active)} />
        <Stat label="Today's target" value={String(plan.target)} />
        <Stat label="Posted today" value={String(plan.postedToday)} />
        <Stat label="Channels" value={channels} />
        <Stat label="Cooldown" value={`${cooldownDays}d`} />
        <Stat label="Last sync" value={settings.lastSyncedAt ? fmtDate(settings.lastSyncedAt) : "never"} />
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <form action={togglePause}>
          <input type="hidden" name="paused" value={(!settings.paused).toString()} />
          <button type="submit">{settings.paused ? "Resume" : "Pause"}</button>
        </form>
        <form action={syncNow}>
          <button type="submit">Sync Drive now</button>
        </form>
        <form action={publishNow}>
          <button type="submit" className="primary">Publish next now</button>
        </form>
      </div>

      <h2>Settings</h2>
      <form className="panel" action={saveSettings}>
        <div className="row" style={{ gap: 20, alignItems: "flex-end" }}>
          <Field label="Reuse cooldown (days)" name="cooldownDays" value={cooldownDays} />
          <Field label="Min / day" name="dailyMin" value={settings.dailyMin} />
          <Field label="Max / day" name="dailyMax" value={settings.dailyMax} />
          <button type="submit" className="primary">Save</button>
        </div>
        <p className="muted" style={{ margin: "12px 0 0" }}>
          Daily volume grows with the pool: roughly{" "}
          <code>min({settings.dailyMax}, pool ÷ {cooldownDays} days)</code>, never below {settings.dailyMin}.
          To sustain {settings.dailyMax}/day you need ~{settings.dailyMax * cooldownDays} videos in the folder.
        </p>
      </form>

      <h2>Drive folder ({counts.active} active · {counts.rejected} rejected · {counts.removed} removed)</h2>
      <div className="panel">
        {media.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing synced yet. Drop files in the Drive folder, then press “Sync Drive now”.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Size</th>
                <th>Dims</th>
                <th>State</th>
                <th>Last posted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {media.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="muted">{m.mime_type.startsWith("video") ? "video" : "image"}</td>
                  <td className="muted">{fmtBytes(Number(m.size_bytes))}</td>
                  <td className="muted">{fmtDims(m)}</td>
                  <td>
                    <StateCell row={m} />
                  </td>
                  <td className="muted">{fmtDate(m.last_posted_at)}</td>
                  <td>
                    {m.status !== "removed" && (
                      <form action={toggleMedia} style={{ textAlign: "right" }}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="enabled" value={(!m.enabled).toString()} />
                        <button type="submit">{m.enabled ? "Disable" : "Enable"}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Recent posts</h2>
      <div className="panel">
        {posts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing published yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{fmtDate(p.created_at)}</td>
                  <td>{p.name ?? <span className="muted">—</span>}</td>
                  <td>
                    <span
                      className={`pill ${
                        p.status === "published" || p.status === "confirmed"
                          ? "good"
                          : p.status === "failed"
                            ? "bad"
                            : ""
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="muted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.error ?? p.provider_post_id ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
    </div>
  );
}

function Field({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }} className="muted">
      {label}
      <input type="text" inputMode="numeric" name={name} defaultValue={value} style={{ width: 90 }} />
    </label>
  );
}

function StateCell({ row }: { row: MediaRow }) {
  if (row.status === "removed") return <span className="pill">removed</span>;
  if (row.status === "rejected") {
    return (
      <span className="pill bad" title={row.reject_reason ?? undefined}>
        rejected
      </span>
    );
  }
  if (!row.enabled) {
    return (
      <span className="pill bad" title={row.last_error ?? undefined}>
        disabled{row.fail_count > 0 ? ` (${row.fail_count} fails)` : ""}
      </span>
    );
  }
  return <span className="pill good">active</span>;
}
