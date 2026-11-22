import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
export const db = client.db('salon_booking_db');
export const userCollection = db.collection('user'); // Better Auth owns this collection.
export const serviceCollection = db.collection('services');
export const appointmentCollection = db.collection('appointments');
export const serviceBookingcollection = appointmentCollection; // Keep existing route imports readable.
export const transactionCollection = db.collection('transactions');

export async function connectToMongoDB() {
    await client.connect();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (item) => item.name,
    );
    // One-time rename preserves all old booking documents and IDs.
    if (names.includes('service-booking') && !names.includes('appointments')) {
        await db.collection('service-booking').rename('appointments');
        console.log('Existing bookings preserved in appointments collection.');
    }
    // Grandfather old conflicting bookings without cancelling or deleting any request.
    // New requests still check every active booking before using the unique index.
    const conflicts = await appointmentCollection
        .aggregate([
            { $match: { status: { $in: ['pending', 'confirmed'] } } },
            {
                $group: {
                    _id: { serviceId: '$serviceId', date: '$date', time: '$time' },
                    ids: { $push: '$_id' },
                    count: { $sum: 1 },
                },
            },
            { $match: { count: { $gt: 1 } } },
        ])
        .toArray();
    await appointmentCollection.updateMany(
        { slotProtected: { $exists: false } },
        { $set: { slotProtected: true } },
    );
    const legacyIds = conflicts.flatMap((group) => group.ids);
    if (legacyIds.length)
        await appointmentCollection.updateMany(
            { _id: { $in: legacyIds } },
            { $set: { slotProtected: false } },
        );
    await appointmentCollection.createIndex(
        { serviceId: 1, date: 1, time: 1 },
        {
            name: 'unique_active_slot',
            unique: true,
            partialFilterExpression: {
                slotProtected: true,
                status: { $in: ['pending', 'confirmed'] },
            },
        },
    );
    await transactionCollection.createIndex({ stripeSessionId: 1 }, { unique: true });
    console.log('MongoDB connected. Legacy conflicting slots preserved:', conflicts.length);
    return client;
}
