// Tell the sidebar which client a page just picked (the client itself travels in the ?client= link)
export function writeCid(id: string) {
  try { window.dispatchEvent(new CustomEvent("cid-change", { detail: id })); } catch {}
}
