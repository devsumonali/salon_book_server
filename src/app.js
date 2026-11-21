import express from 'express';
import cors from 'cors';
import { stripe } from './config/stripe.js';
import routes from './routes/index.js';
import { ObjectId } from 'mongodb';
import { serviceBookingcollection } from './config/database.js';

const app = express();

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripeEvent = req.body;
    // console.log(event, 'event');

    const signature = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET,
        );
    } catch (error) {
        return res.sendStatus(400);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        if (session.payment_status !== 'paid') {
            return res.json({ received: true });
        }

        const bookingId = session.metadata?.bookingId;
        if (typeof bookingId !== 'string' || !ObjectId.isValid(bookingId)) {
            return res.sendStatus(400);
        }

        await serviceBookingcollection.updateOne(
            {
                _id: new ObjectId(bookingId),
            },
            { $set: { status: 'confirmed', paymentStatus: 'paid' } },
        );
    }
    res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use('/', routes);

export default app;
