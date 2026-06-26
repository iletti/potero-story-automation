"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { addMedia } from "../actions";

export function UploadForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage("Choose a video first.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setProgress(0);

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/media/upload",
        contentType: file.type || "application/octet-stream",
        onUploadProgress: (event) => setProgress(Math.round(event.percentage)),
      });

      await addMedia({
        url: blob.url,
        pathname: blob.pathname,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        caption,
      });

      setMessage(`Added "${file.name}".`);
      setCaption("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <div className="row" style={{ marginBottom: 12 }}>
        <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,image/*" disabled={busy} />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Caption (optional)"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Uploading…" : "Upload video"}
        </button>
        {busy && <progress max={100} value={progress} />}
        {message && <span className="muted">{message}</span>}
      </div>
    </form>
  );
}
