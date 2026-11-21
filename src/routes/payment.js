import { Router } from 'express';
import { stripe } from '../config/stripe.js';

const router = Router();

router.post('/checkout', async (req, res) => {
    try {
        return res.status(501).send({
            message: 'Stripe Checkout is not implemented yet',
        });
        // Stripe Checkout Session এখানে তৈরি করব
    } catch (error) {
        res.status(500).send({
            message: 'Payment failed',
        });
    }
});

export default router;
