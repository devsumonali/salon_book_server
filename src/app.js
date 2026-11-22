import express from 'express';
import cors from 'cors';
import { stripe } from './config/stripe.js';
import routes from './routes/index.js';
import { saveCheckoutPayment } from './lib/checkout-payment.js';

const app = express();

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        console.error('STRIPE_WEBHOOK_SECRET is not configured');
        return res.sendStatus(500);
    }

    const signature = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET,
        );
    } catch (error) {
        return res.sendStatus(400);
    }

    if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
    ) {
        const session = event.data.object;

        if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
            return res.json({ received: true });
        }

        try {
            await saveCheckoutPayment(session, new Date(event.created * 1000));
        } catch (error) {
            console.error('Stripe payment update failed:', error.message);
            return res.sendStatus(500);
        }
    }
    res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use('/', routes);

export default app;
