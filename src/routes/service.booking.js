import { Router } from 'express';
import { serviceBookingcollection } from '../config/database.js';

const router = Router();

router.post('/api/bookings', async (req, res) => {
    try {
        const data = req.body;

        const result = await serviceBookingcollection.insertOne(data);

        res.status(201).send({ result });
    } catch (error) {
        res.status(500).send({
            message: 'Booking creation failed',
        });
    }
});

export default router;
