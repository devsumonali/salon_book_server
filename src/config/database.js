import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

//connect mongodb
export async function connectToMongoDB() {
    try {
        await client.connect();
        await serviceBookingcollection.createIndex(
            { userId: 1, serviceId: 1, date: 1, time: 1 },
            {
                name: 'unique_pending_booking',
                unique: true,
                partialFilterExpression: {
                    status: 'pending',
                    paymentStatus: 'unpaid',
                },
            },
        );
        console.log('You successfully connected to MongoDB!');
        return client;
    } catch (err) {
        console.dir(err);
        throw err;
    }
}

//database create
export const db = client.db('salon_booking_db');
export const userCollection = db.collection('user');
export const serviceCollection = db.collection('services');
export const serviceBookingcollection = db.collection('service-booking');
