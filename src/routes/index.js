import { Router } from 'express';
import serviceRoutes from './services/index.js';
import serviceBookingRoutes from './payments/index.js';
import customerRoutes from './customer/index.js';
import profileRoutes from './profile/index.js';
import adminRoutes from './admin/index.js';

const router = Router();

router.use(serviceRoutes);
router.use(serviceBookingRoutes);
router.use(profileRoutes);
router.use(customerRoutes);
router.use(adminRoutes);

router.get('/', (req, res) => {
    res.send('salon server is on!');
});

export default router;
