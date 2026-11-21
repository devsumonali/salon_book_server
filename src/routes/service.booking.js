import { Router } from 'express';
import { serviceBookingcollection, serviceCollection } from '../config/database.js';
import { stripe } from '../config/stripe.js';

const router = Router();

router.post('/api/create-checkout-session', async (req, res) => {
    try {
        const payload = req.body;
        const service = serviceCollection.findOne({ _id: payload.serviceId });

        if (!service) {
            return res.status(404).json({ error: 'service not found' });
        }

        const booking = {
            serviceId: payload.serviceId,
            userEmail: payload.userEmail,
            status: 'pending',
            createdAt: new Date(),
        };

        const result = await serviceBookingcollection.insertOne(booking);

        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: 'us',
                        product_data: {
                            name: service.name,
                            description: service.description,
                        },

                        unit_amount: service.price * 100,
                        quantity: 1,
                    },
                },
            ],
            success_url: `${process.env.CLIENT_URL}/service/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/service/cancel`,
            mode: 'payment',
            metadata: {
                bookingId: result.insertedId.toString(),
                userId: payload.userId,
            },
        });

        console.log(session, 'sesson');
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({
            message: 'Booking creation failed',
        });
    }
});

export default router;
