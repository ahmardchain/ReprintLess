/**
 * PDF bytes stay in this browser (IndexedDB), keyed by document id. The
 * server only ever sees the structured extraction.
 */
const DB = "reprintless";
const STORE = "pdfs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePdf(documentId: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, documentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Private mode or blocked storage: the editor falls back to a wireframe.
  }
}

export async function loadPdf(documentId: string): Promise<Uint8Array | null> {
  try {
    const db = await open();
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(documentId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  } catch {
    return null;
  }
}

export async function deletePdf(documentId: string): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(documentId);
    db.close();
  } catch {
    // ignore
  }
}
