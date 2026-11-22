import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { db, serviceBookingcollection, serviceCollection } from '../config/database.js';
import { stripe } from '../config/stripe.js';
import { saveCheckoutPayment } from '../lib/checkout-payment.js';

const router = Router();

// Payments now start from a confirmed appointment.
router.post('/api/create-checkout-session', (req, res) => {
    res.status(410).send({ message: 'Request an appointment first, then pay after confirmation.' });
});

router.get('/api/checkout-session/:sessionId', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    try {
        const authorization = req.get('authorization');
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

        if (!token) {
            return res.status(401).json({ error: 'Sign in to view this checkout' });
        }

        const loginSession = await db.collection('session').findOne({
            token,
            expiresAt: { $gt: new Date() },
        });

        if (!loginSession) {
            return res.status(401).json({ error: 'Sign in to view this checkout' });
        }

        const { sessionId } = req.params;
        if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
            return res.status(400).json({ error: 'Invalid checkout session' });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items'],
        });

        const userId = loginSession.userId.toString();
        const bookingId = session.metadata?.bookingId;
        if (session.metadata?.userId !== userId || !ObjectId.isValid(bookingId)) {
            return res.status(404).json({ error: 'Checkout session not found' });
        }

        const booking = await serviceBookingcollection.findOne({
            _id: new ObjectId(bookingId),
            userId,
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        await saveCheckoutPayment(session);

        res.json({
            id: session.id,
            bookingId,
            name: session.customer_details?.name || booking.name,
            email: session.customer_details?.email || session.customer_email || booking.userEmail,
            serviceName: session.line_items?.data[0]?.description || 'Salon service',
            date: booking.date,
            time: booking.time,
            notes: booking.notes,
            amountTotal: session.amount_total,
            currency: session.currency,
            paymentStatus: session.payment_status,
            status: session.status,
        });
    } catch (error) {
        res.status(error?.code === 'resource_missing' ? 404 : 500).json({
            error: 'Unable to load checkout details',
        });
    }
});

export default router;
