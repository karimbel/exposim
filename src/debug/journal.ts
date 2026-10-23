/**
 * Journal de diagnostic.
 *
 * Chaque réglage, prise de vue, mise au point, redimensionnement et erreur
 * est noté avec l'état complet du simulateur. Sur la page d'essai publiée
 * dans Claude, le journal est enregistré dans la base de données de la page
 * (collection `journal`), que Claude peut relire directement : plus besoin
 * de copier la console. Ailleurs (GitHub Pages, local), il reste dans la
 * console du navigateur (`[exposim]`).
 */

interface Entry {
  /** Millisecondes depuis l'ouverture de la page. */
  t: number;
  type: string;
  data: unknown;
}

interface DocRef { set(data: Record<string, unknown>): Promise<void> }
interface Db { doc(path: string): DocRef }

const session = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
const buffer: Entry[] = [];
let db: Db | null = null;
let seq = 0;
let timer: number | null = null;

export function journal(type: string, data: unknown = null): void {
  const entry = { t: Math.round(performance.now()), type, data };
  buffer.push(entry);
  if (buffer.length > 2000) buffer.splice(0, buffer.length - 2000);
  console.debug('[exposim]', type, data);
  schedule();
}

function schedule(): void {
  if (!db || timer !== null) return;
  timer = window.setTimeout(flush, 1500);
}

async function flush(): Promise<void> {
  timer = null;
  if (!db || buffer.length === 0) return;
  const entries = buffer.splice(0, 150);
  try {
    await db.doc(`journal/${session}-${String(seq++).padStart(4, '0')}`).set({
      session,
      at: new Date().toISOString(),
      viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      userAgent: navigator.userAgent,
      entries: JSON.parse(JSON.stringify(entries))
    });
  } catch (err) {
    console.warn('[exposim] journal non enregistré', err);
  }
  if (buffer.length) schedule();
}

/** Branche la base de données de la page si elle est disponible (page Claude). */
async function connect(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (claude?.use) {
      db = (await claude.use('db')) as Db | null;
      if (db) schedule();
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

window.addEventListener('error', (e) => journal('erreur', { message: e.message, source: e.filename, ligne: e.lineno }));
window.addEventListener('unhandledrejection', (e) => journal('erreur', { message: String(e.reason) }));
void connect();
