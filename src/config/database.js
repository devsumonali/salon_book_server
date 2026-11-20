import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

//connect mongodb
export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log('You successfully connected to MongoDB!');
        return client;
    } catch (err) {
        console.dir(err);
    }
}

//database create
export const db = client.db('salon_booking_db');
export const userCollection = db.collection('user');
export const serviceCollection = db.collection('services');
