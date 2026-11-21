import { Router } from 'express';
import serviceRoutes from './service.js';
import serviceBookingRoutes from './service.booking.js';
import paymentRoutes from './payment.js';

const router = Router();

router.use(serviceRoutes);
router.use(serviceBookingRoutes);
router.use('/api/payment', paymentRoutes);

router.get('/', (req, res) => {
    res.send('salon server is on!');
});

export default router;
