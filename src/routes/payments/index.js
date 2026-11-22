import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { serviceBookingcollection } from '../../config/database.js';
import { verifyToken, requireCustomer } from '../../middleware/verifyToken.js';
import { stripe } from '../../config/stripe.js';

const router = Router();

// Checkout details are read-only. Paid state comes exclusively from Stripe webhooks.
router.get('/api/checkout-session/:sessionId', verifyToken, requireCustomer, async (req, res) => {
    try {
        if (!/^cs_[a-zA-Z0-9_]+$/.test(req.params.sessionId))
            return res.status(400).send({ message: 'Invalid checkout session' });

        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId, {
            expand: ['line_items'],
        });
        const bookingId = session.metadata?.bookingId;
        if (session.metadata?.userId !== req.user.id || !ObjectId.isValid(bookingId || ''))
            return res.status(404).send({ message: 'Checkout not found' });

        const booking = await serviceBookingcollection.findOne({
            _id: new ObjectId(bookingId),
            userId: req.user.id,
        });

        if (!booking)
            return res.status(404).send({
                message: 'Appointment not found',
            });
        res.send({
            id: session.id,
            bookingId,
            name: booking.name,
            email: booking.userEmail,
            serviceName:
                booking.service?.name ||
                session.line_items?.data?.[0]?.description ||
                'Salon service',
            date: booking.date,
            time: booking.time,
            notes: booking.notes,
            amountTotal: session.amount_total,
            currency: session.currency,
            paymentStatus: session.payment_status,
            status: session.status,
        });
    } catch (error) {
        res.status(error.code === 'resource_missing' ? 404 : 500).send({
            message: 'Unable to load checkout',
        });
    }
});

export default router;
