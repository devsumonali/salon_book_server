import { ObjectId } from 'mongodb';
import { serviceBookingcollection, transactionCollection } from '../config/database.js';

// Called after a signed webhook or server-side Stripe verification. GET stays read-only.
export const saveCheckoutPayment = async (session, paidAt = new Date(), failed = false) => {
    const { bookingId, userId } = session.metadata || {};
    if (
        !ObjectId.isValid(bookingId || '') ||
        !userId ||
        (!failed && !['paid', 'no_payment_required'].includes(session.payment_status))
    )
        return false;
    const booking = await serviceBookingcollection.findOne({
        _id: new ObjectId(bookingId),
        userId,
    });
    if (!booking || !Number.isInteger(session.amount_total) || session.amount_total < 0) return false;
    // A unique Stripe Session ID makes webhook and success-page retries safe.
    try {
        await transactionCollection.updateOne(
            { stripeSessionId: session.id, ...(failed ? { status: { $ne: 'paid' } } : {}) },
            {
                $set: {
                    appointmentId: bookingId,
                    customerId: userId,
                    customerName: booking.name,
                    customerEmail: booking.userEmail,
                    serviceName:
                        booking.service?.name ||
                        session.line_items?.data?.[0]?.description ||
                        'Salon service',
                    appointmentDate: booking.date,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    stripeSessionId: session.id,
                    paymentReference:
                        typeof session.payment_intent === 'string'
                            ? session.payment_intent
                            : session.id,
                    status: failed ? 'failed' : 'paid',
                    createdAt: paidAt,
                },
            },
            { upsert: true },
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    if (!failed)
        await serviceBookingcollection.updateOne(
            { _id: booking._id, paymentStatus: { $ne: 'paid' } },
            {
                $set: {
                    paymentStatus: 'paid',
                    paidAt,
                    paymentReference:
                        typeof session.payment_intent === 'string'
                            ? session.payment_intent
                            : session.id,
                    checkoutSessionId: session.id,
                    amountPaid: session.amount_total / 100,
                    currency: session.currency,
                },
            },
        );
    return !failed;
};
