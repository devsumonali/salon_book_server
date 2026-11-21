import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { db, serviceBookingcollection, serviceCollection } from '../config/database.js';
import { stripe } from '../config/stripe.js';

const router = Router();

router.post('/api/create-checkout-session', async (req, res) => {
    try {
        const payload = req.body;
        if (
            typeof payload?.serviceId !== 'string' ||
            !ObjectId.isValid(payload.serviceId) ||
            ['userId', 'email', 'name', 'date', 'time'].some(
                (field) => typeof payload[field] !== 'string' || !payload[field].trim(),
            )
        ) {
            return res.status(400).json({ error: 'Invalid booking details' });
        }

        const service = await serviceCollection.findOne({ _id: new ObjectId(payload.serviceId) });

        if (!service) {
            return res.status(404).json({ error: 'service not found' });
        }

        if (service.status === 'inactive') {
            return res.status(400).json({ error: 'Service currently unavailable' });
        }

        const booking = {
            serviceId: payload.serviceId,
            userId: payload.userId,
            userEmail: payload.email,
            name: payload.name,
            date: payload.date,
            time: payload.time,
            notes: payload.notes,
            status: 'pending',
            paymentStatus: 'unpaid',
            createdAt: new Date(),
        };

        const result = await serviceBookingcollection.insertOne(booking);
        const clientUrl = process.env.CLIENT_URL.replace(/\/$/, '');

        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: service.name,
                            description: service.description,
                        },

                        unit_amount: Math.round(service.price * 100),
                    },
                    quantity: 1,
                },
            ],
            customer_email: payload.email,
            success_url: `${clientUrl}/service/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${clientUrl}/service/cancel`,
            mode: 'payment',
            metadata: {
                bookingId: result.insertedId.toString(),
                userId: payload.userId,
            },
        });

        res.send({ success: true, url: session.url });
    } catch (error) {
        res.status(500).send({
            message: 'Booking creation failed',
        });
    }
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
