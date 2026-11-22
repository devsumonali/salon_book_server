import { userCollection, db } from '../src/config/database.js';

// Run locally with the email of an existing registered account. Never expose this as a public API.
const email = process.argv[2]?.trim().toLowerCase();
try {
    if (!email) throw new Error('Usage: npm run make-admin -- your-email@example.com');
    const result = await userCollection.updateOne(
        { email },
        { $set: { role: 'admin', isBlocked: false, updatedAt: new Date() } },
    );
    if (!result.matchedCount) throw new Error('Register this account first.');
    console.log('Admin access assigned to the chosen registered account.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await db.client.close();
}
