// Remember the picked client for every page and tell the sidebar
export function writeCid(id: string) {
  try {
    document.cookie = `cid=${id};path=/;max-age=31536000;samesite=lax`;
    window.dispatchEvent(new CustomEvent("cid-change", { detail: id }));
  } catch {}
}
