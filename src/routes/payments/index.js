import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { serviceBookingcollection } from '../../config/database.js';
import { verifyToken, requireCustomer } from '../../middleware/verifyToken.js';
import { stripe } from '../../config/stripe.js';
import { saveCheckoutPayment } from '../../lib/checkout-payment.js';

const router = Router();

// GET reads checkout details. POST verifies Stripe payment and saves it for the owner.
const checkoutSession = async (req, res) => {
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
        let appointmentPaymentStatus = booking.paymentStatus;
        // Verify with Stripe, never trust payment status sent by the browser.
        if (
            req.method === 'POST' &&
            session.status === 'complete' &&
            ['paid', 'no_payment_required'].includes(session.payment_status)
        ) {
            if (!(await saveCheckoutPayment(session)))
                return res.status(409).send({ message: 'Unable to save this payment' });
            appointmentPaymentStatus = 'paid';
        }
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
            appointmentPaymentStatus,
            status: session.status,
        });
    } catch (error) {
        res.status(error.code === 'resource_missing' ? 404 : 500).send({
            message: 'Unable to load checkout',
        });
    }
};

router.get('/api/checkout-session/:sessionId', verifyToken, requireCustomer, checkoutSession);
router.post('/api/checkout-session/:sessionId/verify', verifyToken, requireCustomer, checkoutSession);

export default router;
