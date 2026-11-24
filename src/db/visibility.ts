import { and, eq, ne } from 'drizzle-orm';
import { students } from './schema.js';

type Viewer = { id: number; gender: 'male' | 'female' };

/**
 * THE gender rule. Every query that returns other people (names, lists,
 * leaderboards, matching) MUST filter through one of these two helpers.
 * Anonymous aggregate counts are the only thing allowed to skip them.
 */

/** Active students of the viewer's own gender, excluding the viewer. */
export const visiblePeers = (me: Viewer) =>
  and(eq(students.gender, me.gender), eq(students.status, 'active'), ne(students.id, me.id));

/** Same as above but includes the viewer (for leaderboards). */
export const visibleGroup = (me: Viewer) => and(eq(students.gender, me.gender), eq(students.status, 'active'));

/** Pure check, handy for tests and for non-SQL code paths. */
export const canSee = (viewer: Viewer, other: { gender: 'male' | 'female' }) => viewer.gender === other.gender;
