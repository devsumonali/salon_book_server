import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { serviceCollection } from '../../config/database.js';
import { verifyToken, requireAdmin } from '../../middleware/verifyToken.js';
import { serviceData } from '../../lib/service-data.js';

const router = Router();

// Public service menu: only active services, optional search/category/price sorting.
router.get('/api/services', async (req, res) => {
    try {
        const query = { status: 'active' };
        const categories = [req.query.category]
            .flat()
            .filter((value) => typeof value === 'string' && value);
        if (categories.length) query.category = { $in: categories };
        if (typeof req.query.search === 'string' && req.query.search.trim()) {
            query.name = {
                $regex: req.query.search.trim().replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'),
                $options: 'i',
            };
        }
        const sort =
            req.query.sort === 'price-asc'
                ? { price: 1 }
                : req.query.sort === 'price-desc'
                  ? { price: -1 }
                  : { createdAt: -1 };
        res.send(await serviceCollection.find(query).sort(sort).toArray());
    } catch {
        res.status(500).send({ message: 'Failed to fetch services' });
    }
});

// Protected service details. Inactive services are visible only to an admin.
router.get('/api/services/:id', verifyToken, async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(404).send({
                message: 'Service not found',
            });
        const query = {
            _id: new ObjectId(req.params.id),
        };
        if (req.user.role !== 'admin') query.status = 'active';

        const service = await serviceCollection.findOne(query);

        if (!service) return res.status(404).send({ message: 'Service not found' });
        res.send(service);
    } catch {
        res.status(500).send({ message: 'Failed to load service' });
    }
});

// Create a service: admin role is verified on the Express server.
router.post('/api/services', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { data, error } = serviceData(req.body, true);

        if (error) return res.status(400).send({ message: error });
        res.status(201).send(await serviceCollection.insertOne(data));
    } catch {
        res.status(500).send({ message: 'Failed to create service' });
    }
});

// Update fields or activate/deactivate a service.
router.patch('/api/services/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).send({ message: 'Invalid service ID' });
        const { data, error } = serviceData(req.body);

        if (error)
            return res.status(400).send({
                message: error,
            });
        const result = await serviceCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { ...data, updatedAt: new Date() } },
        );
        if (!result.matchedCount)
            return res.status(404).send({
                message: 'Service not found',
            });
        res.send(result);
    } catch {
        res.status(500).send({ message: 'Failed to update service' });
    }
});

router.delete('/api/services/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).send({
                message: 'Invalid service ID',
            });

        const result = await serviceCollection.deleteOne({
            _id: new ObjectId(req.params.id),
        });
        if (!result.deletedCount) return res.status(404).send({ message: 'Service not found' });
        res.send(result);
    } catch {
        res.status(500).send({
            message: 'Failed to delete service',
        });
    }
});

export default router;
