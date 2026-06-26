import { getSql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { UploadForm } from "./components/UploadForm";
import { deleteMedia, publishNow, toggleMedia, togglePause } from "./actions";

export const dynamic = "force-dynamic";

type MediaRow = {
  id: string;
  caption: string;
  content_type: string;
  size_bytes: string;
  enabled: boolean;
  last_posted_at: string | null;
  created_at: string;
};

type PostRow = {
  id: string;
  status: string;
  provider_post_id: string | null;
  error: string | null;
  created_at: string;
  caption: string | null;
};

function fmtBytes(bytes: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function fmtDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" });
}

export default async function Home() {
  const sql = getSql();
  const settings = await getSettings();

  const media = (await sql`
    select id, caption, content_type, size_bytes, enabled, last_posted_at, created_at
    from media
    order by created_at desc
  `) as MediaRow[];

  const posts = (await sql`
    select p.id, p.status, p.provider_post_id, p.error, p.created_at, m.caption
    from post_log p
    left join media m on m.id = p.media_id
    order by p.created_at desc
    limit 15
  `) as PostRow[];

  const eligible = media.filter((m) => m.enabled).length;

  return (
    <main>
      <div className="row spread">
        <h1>Potero Story Automation</h1>
        <span className="muted">{eligible} active · {media.length} total videos</span>
      </div>

      <div className={`banner ${settings.paused ? "paused" : "live"}`} style={{ marginTop: 16 }}>
        {settings.paused
          ? "Paused — no Stories are being published."
          : `Live — publishing every scheduled slot (reuse cooldown ${Math.round(settings.minReuseHours / 24)} days).`}
      </div>

      <div className="row">
        <form action={togglePause}>
          <input type="hidden" name="paused" value={(!settings.paused).toString()} />
          <button type="submit">{settings.paused ? "Resume" : "Pause"}</button>
        </form>
        <form action={publishNow}>
          <button type="submit" className="primary">Publish next now</button>
        </form>
      </div>

      <h2>Upload</h2>
      <UploadForm />

      <h2>Video pool</h2>
      <div className="panel">
        {media.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No videos yet. Upload one above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Caption</th>
                <th>Size</th>
                <th>Status</th>
                <th>Last posted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {media.map((m) => (
                <tr key={m.id}>
                  <td>{m.caption || <span className="muted">(no caption)</span>}</td>
                  <td className="muted">{fmtBytes(Number(m.size_bytes))}</td>
                  <td>
                    <span className={`pill ${m.enabled ? "good" : ""}`}>
                      {m.enabled ? "active" : "disabled"}
                    </span>
                  </td>
                  <td className="muted">{fmtDate(m.last_posted_at)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <form action={toggleMedia}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="enabled" value={(!m.enabled).toString()} />
                        <button type="submit">{m.enabled ? "Disable" : "Enable"}</button>
                      </form>
                      <form action={deleteMedia}>
                        <input type="hidden" name="id" value={m.id} />
                        <button type="submit" className="danger">Delete</button>
                      </form>
                    </div>
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
                <th>Caption</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{fmtDate(p.created_at)}</td>
                  <td>{p.caption || <span className="muted">—</span>}</td>
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
