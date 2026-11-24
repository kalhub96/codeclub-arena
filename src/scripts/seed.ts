import { eq } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import { languages, tracks } from '../db/schema.js';

export const CATALOG: Record<string, string[]> = {
  'Full Stack': ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'Node.js', 'SQL', 'React'],
  Cyber: ['Networking', 'Linux/Bash', 'Python for Security', 'Web Security', 'Cryptography'],
  AI: ['Python', 'NumPy/Pandas', 'Machine Learning', 'Deep Learning'],
};

async function main() {
  for (const [trackName, langs] of Object.entries(CATALOG)) {
    await db.insert(tracks).values({ name: trackName }).onConflictDoNothing();
    const [t] = await db.select().from(tracks).where(eq(tracks.name, trackName));
    if (!t) throw new Error(`track ${trackName} missing`);
    let order = 0;
    for (const name of langs) {
      await db.insert(languages).values({ trackId: t.id, name, orderNo: order++ }).onConflictDoNothing();
    }
  }
  console.log('Seeded tracks and languages.');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
